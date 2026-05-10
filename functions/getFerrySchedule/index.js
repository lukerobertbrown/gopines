const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const vision = require("@google-cloud/vision");
const { DateTime } = require("luxon");

const { discoverPinesScheduleAssets } = require("./sayvilleDiscover");
const { parseVisionDocumentResult } = require("./sayvilleParseVision");

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
    if (existing.exists && existing.data()?.pngUrl === assets.pngUrl) {
      console.log("ingestSayvilleFerryPines: PNG URL unchanged, skipping Vision");
      return null;
    }

    const pngRes = await fetch(assets.pngUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; gopines/1.0; +https://gopines.gay)" },
    });
    if (!pngRes.ok) throw new Error(`PNG fetch failed: ${pngRes.status}`);
    const pngBuf = Buffer.from(await pngRes.arrayBuffer());

    const client = new vision.ImageAnnotatorClient();
    const [result] = await client.documentTextDetection({ image: { content: pngBuf } });
    if (result.error && result.error.message) {
      throw new Error(`Vision API: ${result.error.message}`);
    }

    const { trips, parseNotes } = parseVisionDocumentResult(result);

    await docRef.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      effectiveLabel: assets.effectiveLabel,
      pngTitle: assets.pngTitle,
      sourcePageUrl: assets.sourcePageUrl,
      pngUrl: assets.pngUrl,
      pdfUrl: assets.pdfUrl || null,
      trips,
      parseVersion: 1,
      visionConfidenceNote: parseNotes,
    });

    console.log(`ingestSayvilleFerryPines: stored ${trips.length} trips (${parseNotes})`);
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
