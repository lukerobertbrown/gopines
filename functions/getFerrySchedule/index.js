const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const vision = require("@google-cloud/vision");
const { DateTime } = require("luxon");

const { discoverPinesScheduleAssets } = require("./sayvilleDiscover");
const { parseVisionDocumentResult } = require("./sayvilleParseVision");
const { parseSayvillePinesPdf } = require("./sayvilleParsePdf");

setGlobalOptions({
  region: "us-east1",
  memory: "256MiB",
  timeoutSeconds: 10,
});

// Explicit allow-list. The previous /gopines\.gay$/ regex matched evil-gopines.gay
// because it wasn't anchored to the start of the Origin string.
const corsOrigins = [
  "https://gopines.gay",
  "https://www.gopines.gay",
  "https://gopines.web.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

// Optional shared-secret bearer token for the force-* endpoints. Set via
//   firebase functions:secrets:set FORCE_TRIGGER_TOKEN
// The endpoints fall open if the secret isn't configured (so existing deploys
// don't break) but log a warning so we notice.
const FORCE_TRIGGER_TOKEN = defineSecret("FORCE_TRIGGER_TOKEN");

function checkBearerToken(req, res, secret) {
  const expected = secret && typeof secret.value === "function" ? secret.value() : null;
  if (!expected) {
    console.warn("FORCE_TRIGGER_TOKEN not configured — endpoint is publicly callable.");
    return true;
  }
  const auth = String(req.headers.authorization || "");
  if (auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// Wrap fetch with an abort-after-Nms timeout so an upstream hang doesn't
// hold the function up to its global timeoutSeconds. Returns the standard
// Response object on success.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const FERRY_CACHE = "ferry_cache";
const PINES_DOC = "pines_schedule";
const TZ = "America/New_York";
const WALK_FROM_STATION_SEC = 600;

/** Bump when parser logic changes to force a fresh ingest of unchanged source URLs. */
const CURRENT_INGEST_VERSION = 5;

/**
 * @param {FirebaseFirestore.DocumentData[]|undefined} trips
 * @param {number} trainArrivalUnix
 * @param {number} limit
 */
function selectFerriesAfterTrain(trips, trainArrivalUnix, limit) {
  const list = Array.isArray(trips) ? trips : [];
  const dt = DateTime.fromSeconds(trainArrivalUnix, { zone: TZ });
  const ymd = dt.toFormat("yyyy-MM-dd");
  // Luxon weekday: Mon=1..Sun=7. JS day: Sun=0..Sat=6.
  const dow = dt.weekday % 7;
  const threshold = trainArrivalUnix + WALK_FROM_STATION_SEC;
  return list
    .filter((t) => t && (t.direction === "sayville_to_pines" || t.direction === "unknown"))
    // Empty daysOfWeek means "no day restriction" (matches frontend semantics).
    .filter((t) => !Array.isArray(t.daysOfWeek) || t.daysOfWeek.length === 0 || t.daysOfWeek.includes(dow))
    // Effective-date window — keep parity with the frontend's ferriesForDay().
    .filter((t) => !t.effectiveStart || ymd >= t.effectiveStart)
    .filter((t) => !t.effectiveEnd || ymd <= t.effectiveEnd)
    .map((t) => {
      const departDt = DateTime.fromISO(`${ymd}T${t.departureTime}`, { zone: TZ });
      if (!departDt.isValid) return null;
      return {
        departureTime: t.departureTime,
        direction: t.direction,
        sourceColumn: t.sourceColumn,
        rawLine: t.rawLine,
        daysOfWeek: t.daysOfWeek,
        dayLabel: t.dayLabel,
        departUnix: Math.floor(departDt.toSeconds()),
      };
    })
    .filter(Boolean)
    .filter((x) => x.departUnix >= threshold)
    .sort((a, b) => a.departUnix - b.departUnix)
    .slice(0, limit);
}

/**
 * Shared ingestion logic — used by the scheduled job and the on-demand
 * forceIngestSayvilleFerryPines endpoint. When `force` is true, the version
 * + URL guard is skipped.
 */
async function ingestPinesSchedule({ force = false } = {}) {
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

  if (!force && existing.exists && alreadyOk) {
    console.log("ingestPinesSchedule: skip (same assets, current version, trips populated)");
    return { skipped: true, reason: "unchanged" };
  }

  const fetchOpts = {
    headers: { "user-agent": "Mozilla/5.0 (compatible; gopines/1.0; +https://gopines.gay)" },
  };

  const pngRes = await fetchWithTimeout(assets.pngUrl, fetchOpts, 20000);
  if (!pngRes.ok) throw new Error(`PNG fetch failed: ${pngRes.status}`);
  const pngBuf = Buffer.from(await pngRes.arrayBuffer());

  const client = new vision.ImageAnnotatorClient();
  const [result] = await client.documentTextDetection({ image: { content: pngBuf } });
  if (result.error && result.error.message) {
    throw new Error(`Vision API: ${result.error.message}`);
  }

  const parsed = parseVisionDocumentResult(result);
  const trips = parsed.trips;
  let parseNotes = parsed.parseNotes;
  const scheduleTitle = parsed.scheduleTitle ?? null;
  const effectiveDateRange = parsed.effectiveDateRange ?? null;

  // Cross-reference with the PDF (if available). The PDF preserves real
  // glyphs, so it has reliable ▲ markers and STARTS/ENDS/ONLY annotations
  // that OCR drops. We use Vision as the source of truth for trip *existence*
  // and let the PDF augment each trip's `extraStops` / `effectiveStart` /
  // `effectiveEnd` attributes by matching on (dayLabel, direction, time).
  let pdfAugmented = 0;
  try {
    if (assets.pdfUrl) {
      const pdfRes = await fetchWithTimeout(assets.pdfUrl, fetchOpts, 20000);
      if (pdfRes.ok) {
        const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
        const pdfParsed = await parseSayvillePinesPdf(pdfBuf, { scheduleTitle });
        const pdfTrips = pdfParsed.trips || [];
        // Index by (dayLabel|direction|HH:MM) for O(1) lookup.
        const idx = new Map();
        for (const p of pdfTrips) {
          const key = `${p.dayLabel}|${p.direction}|${p.departureTime}`;
          idx.set(key, p);
        }
        for (const t of trips) {
          const key = `${t.dayLabel}|${t.direction}|${t.departureTime}`;
          const m = idx.get(key);
          if (!m) continue;
          if (typeof m.extraStops === "boolean") t.extraStops = m.extraStops;
          if (m.effectiveStart) t.effectiveStart = m.effectiveStart;
          if (m.effectiveEnd) t.effectiveEnd = m.effectiveEnd;
          pdfAugmented++;
        }
        parseNotes = `${parseNotes}+pdf:${pdfParsed.parseNotes}|augmented=${pdfAugmented}`;
      } else {
        parseNotes = `${parseNotes}+pdf_fetch_${pdfRes.status}`;
      }
    }
  } catch (e) {
    console.warn("PDF cross-reference failed:", (e && e.message) || e);
    parseNotes = `${parseNotes}+pdf_error`;
  }

  await docRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    effectiveLabel: assets.effectiveLabel,
    pngTitle: assets.pngTitle,
    sourcePageUrl: assets.sourcePageUrl,
    pngUrl: assets.pngUrl,
    pdfUrl: assets.pdfUrl || null,
    scheduleTitle,
    effectiveDateRange,
    trips,
    parseVersion: CURRENT_INGEST_VERSION,
    parseSource: "vision",
    visionConfidenceNote: parseNotes,
  });

  console.log(`ingestPinesSchedule: stored ${trips.length} trips (${parseNotes})`);
  return { ok: true, count: trips.length, parseNotes };
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
    await ingestPinesSchedule({ force: false });
    return null;
  },
);

exports.forceIngestSayvilleFerryPines = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
    memory: "1GiB",
    timeoutSeconds: 300,
    secrets: [FORCE_TRIGGER_TOKEN],
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (!checkBearerToken(req, res, FORCE_TRIGGER_TOKEN)) return;
    try {
      const result = await ingestPinesSchedule({ force: true });
      res.status(200).json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String((e && e.message) || e) });
    }
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
            "Ferry schedule not ingested yet. The daily job runs at 6:00 America/New_York, or call /forceIngestSayvilleFerryPines once.",
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
        scheduleTitle: data.scheduleTitle ?? null,
        effectiveDateRange: data.effectiveDateRange ?? null,
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
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  },
);
