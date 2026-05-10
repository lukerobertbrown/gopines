const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { buildSchedulePayload, formatYmdNy, STATIONS } = require("./pennSayvilleSchedule");
const {
  fetchLirrGtfsRt,
  decodeFeed,
  buildTripRealtimeIndex,
  mergeRealtimeIntoPayload,
  feedToSummaryJson,
} = require("./lirrGtfsRt");

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

// Optional shared-secret bearer token for the force-* endpoint. Set via
//   firebase functions:secrets:set FORCE_TRIGGER_TOKEN
// Falls open if the secret isn't configured (so existing deploys don't break)
// but logs a warning so we notice.
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

// We always parse and cache the full 14-day window. Shorter requests slice it.
const REFRESH_DAYS = 14;
const LIRR_CACHE_COLLECTION = "lirr_cache";
/** Firestore doc name for each station key. */
const STATION_DOC_NAMES = {
  penn:            "penn_sayville_schedule",
  "grand-central": "grand_central_sayville_schedule",
  atlantic:        "atlantic_terminal_sayville_schedule",
  woodside:        "woodside_sayville_schedule",
};
/** Bump when buildSchedulePayload's output shape changes meaningfully. */
const CURRENT_LIRR_VERSION = 1;
/** Stale-fallback threshold for the Firestore doc — beyond this, HTTP handlers
 * proactively re-fetch even if the scheduled job hasn't run yet. */
const FIRESTORE_MAX_AGE_MS = 26 * 60 * 60 * 1000;

/** In-memory caches keyed by station key. */
const scheduleCaches = {};
const SCHEDULE_TTL_MS = 30 * 60 * 1000;

const liveScheduleCaches = {};
const LIVE_SCHEDULE_TTL_MS = 60 * 1000;

/**
 * Fetch + parse the GTFS for one station, store in Firestore. Used by the
 * scheduled job (force=false, skips when fresh) and the on-demand endpoint
 * (force=true).
 */
async function refreshLirrScheduleForStation(stationKey, { force = false } = {}) {
  const station = STATIONS[stationKey];
  if (!station) throw new Error(`Unknown station key: ${stationKey}`);
  const docName = STATION_DOC_NAMES[stationKey];
  const db = admin.firestore();
  const docRef = db.collection(LIRR_CACHE_COLLECTION).doc(docName);

  if (!force) {
    const existing = await docRef.get();
    const data = existing.exists ? existing.data() : null;
    const ageMs = data && data.updatedAt ? Date.now() - data.updatedAt.toMillis() : Infinity;
    const fresh =
      data &&
      data.parseVersion === CURRENT_LIRR_VERSION &&
      data.payload &&
      Array.isArray(data.payload.days) &&
      data.payload.days.length > 0 &&
      ageMs < FIRESTORE_MAX_AGE_MS;
    if (fresh) {
      console.log(`refreshLirrSchedule[${stationKey}]: skip (${Math.round(ageMs / 60000)}m old, version ok)`);
      return { skipped: true, stationKey, reason: "fresh" };
    }
  }

  const payload = await buildSchedulePayload(REFRESH_DAYS, station.id);
  await docRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    parseVersion: CURRENT_LIRR_VERSION,
    payload,
  });
  // Reset in-memory caches so the next request picks up the new payload.
  scheduleCaches[stationKey] = { payload: null, loadedAt: 0, days: 0 };
  liveScheduleCaches[stationKey] = { payload: null, loadedAt: 0, days: 0 };
  const count = (payload.days || []).length;
  console.log(`refreshLirrSchedule[${stationKey}]: wrote ${count} day(s) to Firestore`);
  return { ok: true, stationKey, count };
}

exports.refreshLirrGtfs = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/New_York",
    region: "us-east1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    for (const key of Object.keys(STATIONS)) {
      await refreshLirrScheduleForStation(key, { force: false });
    }
    return null;
  },
);

exports.forceRefreshLirrGtfs = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: [FORCE_TRIGGER_TOKEN],
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (!checkBearerToken(req, res, FORCE_TRIGGER_TOKEN)) return;
    try {
      const results = [];
      for (const key of Object.keys(STATIONS)) {
        results.push(await refreshLirrScheduleForStation(key, { force: true }));
      }
      res.status(200).json({ ok: true, results });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  },
);

/**
 * Read the cached 14-day payload for a station, preferring Firestore. Falls
 * back to a live fetch + write-through if the doc is missing or stale.
 */
async function getCachedLirrPayload(stationKey) {
  const station = STATIONS[stationKey];
  if (!station) throw new Error(`Unknown station key: ${stationKey}`);
  const docName = STATION_DOC_NAMES[stationKey];
  const db = admin.firestore();
  const docRef = db.collection(LIRR_CACHE_COLLECTION).doc(docName);
  const snap = await docRef.get();
  if (snap.exists) {
    const data = snap.data();
    const ageMs = data && data.updatedAt ? Date.now() - data.updatedAt.toMillis() : Infinity;
    if (
      data &&
      data.parseVersion === CURRENT_LIRR_VERSION &&
      data.payload &&
      Array.isArray(data.payload.days) &&
      data.payload.days.length > 0 &&
      ageMs < FIRESTORE_MAX_AGE_MS
    ) {
      return data.payload;
    }
  }
  // Firestore doc missing/stale — fetch fresh and write through.
  const fresh = await buildSchedulePayload(REFRESH_DAYS, station.id);
  await docRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    parseVersion: CURRENT_LIRR_VERSION,
    payload: fresh,
  });
  return fresh;
}

/** Trim a 14-day payload to N days while preserving everything else (top-level
 * stops/timezone/disclaimer/source/feedVersion). */
function sliceDaysFromPayload(payload, days) {
  if (!payload || !Array.isArray(payload.days)) return payload;
  if (days >= payload.days.length) return payload;
  return { ...payload, days: payload.days.slice(0, days) };
}

exports.getLIRRDepartures = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
  },
  (req, res) => {
    res.status(200).json({ ok: true, message: "placeholder — use getLirrSchedule or getLirrScheduleLive" });
  },
);

/** Static GTFS only — no secrets required. Reads from Firestore. */
exports.getLirrSchedule = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
    memory: "1GiB",
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      const originKey = String(req.query.origin || "penn");
      if (!STATIONS[originKey]) {
        res.status(400).json({ error: `Unknown origin: "${originKey}". Valid: ${Object.keys(STATIONS).join(", ")}` });
        return;
      }
      const days = Math.min(14, Math.max(1, parseInt(String(req.query.days || "14"), 10) || 14));
      const now = Date.now();
      const cache = scheduleCaches[originKey] || { payload: null, loadedAt: 0, days: 0 };
      if (cache.payload && cache.days === days && now - cache.loadedAt < SCHEDULE_TTL_MS) {
        res.set("Cache-Control", "public, max-age=300");
        res.status(200).json(cache.payload);
        return;
      }
      const fullPayload = await getCachedLirrPayload(originKey);
      const payload = sliceDaysFromPayload(fullPayload, days);
      scheduleCaches[originKey] = { payload, loadedAt: now, days };
      res.set("Cache-Control", "public, max-age=300");
      res.status(200).json(payload);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e && e.message ? e.message : e) });
    }
  },
);

/** Static schedule (Firestore-cached) + MTA GTFS-Realtime delays merged on
 * the request path. Live data is intentionally NOT pre-fetched — by definition
 * realtime delays must be read at the moment of the request. */
exports.getLirrScheduleLive = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
    memory: "1GiB",
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      const originKey = String(req.query.origin || "penn");
      if (!STATIONS[originKey]) {
        res.status(400).json({ error: `Unknown origin: "${originKey}". Valid: ${Object.keys(STATIONS).join(", ")}` });
        return;
      }
      const days = Math.min(14, Math.max(1, parseInt(String(req.query.days || "14"), 10) || 14));
      const now = Date.now();
      const cache = liveScheduleCaches[originKey] || { payload: null, loadedAt: 0, days: 0 };
      if (cache.payload && cache.days === days && now - cache.loadedAt < LIVE_SCHEDULE_TTL_MS) {
        res.set("Cache-Control", "public, max-age=30");
        res.status(200).json(cache.payload);
        return;
      }

      const fullPayload = await getCachedLirrPayload(originKey);
      const basePayload = sliceDaysFromPayload(fullPayload, days);
      // Clone so the realtime merge doesn't mutate the cached static payload.
      const payload = JSON.parse(JSON.stringify(basePayload));

      const rtBuf = await fetchLirrGtfsRt();
      const feed = decodeFeed(rtBuf);
      const index = buildTripRealtimeIndex(feed);
      const todayYmd = formatYmdNy(new Date());
      mergeRealtimeIntoPayload(payload, index, todayYmd);

      const headerTs =
        feed.header && feed.header.timestamp != null
          ? Number(
              typeof feed.header.timestamp === "object" &&
                feed.header.timestamp != null &&
                typeof feed.header.timestamp.toNumber === "function"
                ? feed.header.timestamp.toNumber()
                : feed.header.timestamp,
            )
          : null;

      payload.realtime = {
        source: "MTA GTFS-Realtime (lirr/gtfs-lirr)",
        mergedForDate: todayYmd,
        feedHeaderTimestamp: headerTs,
        note: "Delays merged onto legs for today only (matched by trip_id + stop_id). Feed fetched without API key.",
      };

      liveScheduleCaches[originKey] = { payload, loadedAt: now, days };
      res.set("Cache-Control", "public, max-age=30");
      res.status(200).json(payload);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e && e.message ? e.message : e) });
    }
  },
);

exports.getLirrRealtime = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
    memory: "512MiB",
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      const rtBuf = await fetchLirrGtfsRt();
      const feed = decodeFeed(rtBuf);
      const summary = feedToSummaryJson(feed, 200);
      res.set("Cache-Control", "public, max-age=30");
      res.status(200).json(summary);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e && e.message ? e.message : e) });
    }
  },
);
