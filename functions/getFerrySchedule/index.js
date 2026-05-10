const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const vision = require("@google-cloud/vision");
const pdfParse = require("pdf-parse");
const { DateTime } = require("luxon");

const { discoverPinesScheduleAssets } = require("./sayvilleDiscover");
const { parseVisionDocumentResult } = require("./sayvilleParseVision");
const { parseSayvillePdfText } = require("./sayvilleParsePdf");

setGlobalOptions({
  region: "us-east1",
  memory: "256MiB",
  timeoutSeconds: 10,
});

const corsOrigins = [/gopines\.gay$/, "http://localhost:5173", "http://127.0.0.1:5173"];

const FERRY_CACHE = "ferry_cache";
const PINES_DOC = "pines_schedule";
const TZ = "America/New_York";
const WALK_FROM_STATION_SEC = 600;

/** Bump when parser / ingest logic changes to force a fresh run for the same PNG/PDF URLs. */
const CURRENT_INGEST_VERSION = 2;

/**
 * @param {FirebaseFirestore.DocumentData | undefined} trips
 * @param {number} trainArrivalUnix
 * @param {number} limit
 */
function selectFerriesAfterTrain(trips, trainArrivalUnix, limit) {
  const list = Array.isArray(trips) ? trips : [];
  const ymd = DateTime.fromSeconds(trainArrivalUnix, { zone: TZ }).toFormat("yyyy-MM-dd");
  const threshold = trainArrivalUnix + WALK_FROM_STATION_SEC;
  return list
    .filter((t) => t && (t.direction === "sayville_to_pines" || t.direction === "unknown"))
    .map((t) => {
      const dt = DateTime.fromISO(`${ymd}T${t.departureTime}`, { zone: TZ });
      if (!dt.isValid) return null;
      const { departureTime, direction, sourceColumn, rawLine } = t;
      return {
        departureTime,
        direction,
        sourceColumn,
        rawLine,
        departUnix: Math.floor(dt.toSeconds()),
      };
    })
    .filter(Boolean)
    .filter((x) => x.departUnix >= threshold)
    .sort((a, b) => a.departUnix - b.departUnix)
    .slice(0, limit);
}

exports.ingestSayvilleFerryPines = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/New_York",
    region: "us-east1",
    memory: "1GiB",
    timeoutSeconds: 300,
  },
  async () => {
    const assets = await discoverPinesScheduleAssets();
    const db = admin.firestore();
    const docRef = db.collection(FERRY_CACHE).doc(PINES_DOC);
    const existing = await docRef.get();
    const ex = existing.data();

    const sameAssets =
      ex?.pngUrl === assets.pngUrl && (ex?.pdfUrl || "") === (assets.pdfUrl || "");
    const alreadyOk =
      sameAssets &&
      ex?.parseVersion === CURRENT_INGEST_VERSION &&
      Array.isArray(ex?.trips) &&
      ex.trips.length > 0;

    if (existing.exists && alreadyOk) {
      console.log("ingestSayvilleFerryPines: skip (same assets, trips already populated)");
      return null;
    }

    const fetchOpts = {
      headers: { "user-agent": "Mozilla/5.0 (compatible; gopines/1.0; +https://gopines.gay)" },
    };

    /** @type {object[]} */
    let trips = [];
    let parseNotes = "none";
    let parseSource = "none";

    if (assets.pdfUrl) {
      const pdfRes = await fetch(assets.pdfUrl, fetchOpts);
      if (pdfRes.ok) {
        const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
        const pdfData = await pdfParse(pdfBuf);
        const parsed = parseSayvillePdfText(pdfData.text);
        trips = parsed.trips;
        parseNotes = parsed.parseNotes;
        parseSource = "pdf";
      } else {
        parseNotes = `pdf_fetch_${pdfRes.status}`;
      }
    }

    if (trips.length === 0) {
      const pngRes = await fetch(assets.pngUrl, fetchOpts);
      if (!pngRes.ok) throw new Error(`PNG fetch failed: ${pngRes.status}`);
      const pngBuf = Buffer.from(await pngRes.arrayBuffer());

      const client = new vision.ImageAnnotatorClient();
      const [result] = await client.documentTextDetection({ image: { content: pngBuf } });
      if (result.error && result.error.message) {
        throw new Error(`Vision API: ${result.error.message}`);
      }

      const parsed = parseVisionDocumentResult(result);
      trips = parsed.trips;
      parseNotes = parsed.parseNotes;
      parseSource = "vision";
    }

    await docRef.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      effectiveLabel: assets.effectiveLabel,
      pngTitle: assets.pngTitle,
      sourcePageUrl: assets.sourcePageUrl,
      pngUrl: assets.pngUrl,
      pdfUrl: assets.pdfUrl || null,
      trips,
      parseVersion: CURRENT_INGEST_VERSION,
      parseSource,
      visionConfidenceNote: parseNotes,
    });

    console.log(
      `ingestSayvilleFerryPines: stored ${trips.length} trips (source=${parseSource}, ${parseNotes})`,
    );
    return null;
  },
);

exports.getFerrySchedule = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      const snap = await admin.firestore().collection(FERRY_CACHE).doc(PINES_DOC).get();
      if (!snap.exists) {
        res.status(503).json({
          error:
            "Ferry schedule not ingested yet. The daily job runs at 6:00 America/New_York, or trigger the scheduled function once from GCP.",
        });
        return;
      }

      const data = snap.data();
      if (!data) {
        res.status(503).json({ error: "Empty ferry document" });
        return;
      }

      let nextFerriesFromSayville = null;
      const trainArrival = req.query.trainArrival;
      if (trainArrival != null && trainArrival !== "") {
        const ts = parseInt(String(trainArrival), 10);
        if (!Number.isNaN(ts)) {
          nextFerriesFromSayville = selectFerriesAfterTrain(data.trips, ts, 2);
        }
      }

      const updatedAt =
        data.updatedAt && typeof data.updatedAt.toDate === "function"
          ? data.updatedAt.toDate().toISOString()
          : null;

      res.set("Cache-Control", "public, max-age=120");
      res.status(200).json({
        effectiveLabel: data.effectiveLabel,
        updatedAt,
        sourcePageUrl: data.sourcePageUrl,
        pngUrl: data.pngUrl,
        pdfUrl: data.pdfUrl ?? null,
        trips: data.trips || [],
        parseVersion: data.parseVersion,
        parseSource: data.parseSource || null,
        parseNotes: data.visionConfidenceNote,
        walkFromStationMin: WALK_FROM_STATION_SEC / 60,
        nextFerriesFromSayville,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e && e.message ? e.message : e) });
    }
  },
);
