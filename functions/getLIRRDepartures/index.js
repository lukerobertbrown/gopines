const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { buildSchedulePayload, formatYmdNy } = require("./pennSayvilleSchedule");
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

const corsOrigins = [/gopines\.gay$/, "http://localhost:5173", "http://127.0.0.1:5173"];

// We always parse and cache the full 14-day window. Shorter requests slice it.
const REFRESH_DAYS = 14;
const LIRR_CACHE_COLLECTION = "lirr_cache";
const LIRR_CACHE_DOC = "penn_sayville_schedule";
/** Bump when buildSchedulePayload's output shape changes meaningfully. */
const CURRENT_LIRR_VERSION = 1;
/** Stale-fallback threshold for the Firestore doc — beyond this, HTTP handlers
 * proactively re-fetch even if the scheduled job hasn't run yet. */
const FIRESTORE_MAX_AGE_MS = 26 * 60 * 60 * 1000;

/** @type {{ payload: object | null; loadedAt: number; days: number }} */
let scheduleCache = { payload: null, loadedAt: 0, days: 0 };
const SCHEDULE_TTL_MS = 30 * 60 * 1000;

/** @type {{ payload: object | null; loadedAt: number; days: number }} */
let liveScheduleCache = { payload: null, loadedAt: 0, days: 0 };
const LIVE_SCHEDULE_TTL_MS = 60 * 1000;

/**
 * Fetch + parse the GTFS, store the full 14-day payload in Firestore. Used by
 * the scheduled job (force=false, skips when fresh) and the on-demand endpoint
 * (force=true).
 */
async function refreshLirrSchedule({ force = false } = {}) {
  const db = admin.firestore();
  const docRef = db.collection(LIRR_CACHE_COLLECTION).doc(LIRR_CACHE_DOC);

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
      console.log(`refreshLirrSchedule: skip (doc ${Math.round(ageMs / 60000)}m old, parseVersion ok)`);
      return { skipped: true, reason: "fresh" };
    }
  }

  const payload = await buildSchedulePayload(REFRESH_DAYS);
  await docRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    parseVersion: CURRENT_LIRR_VERSION,
    payload,
  });
  // Reset in-memory caches so the next request picks up the new payload.
  scheduleCache = { payload: null, loadedAt: 0, days: 0 };
  liveScheduleCache = { payload: null, loadedAt: 0, days: 0 };
  const count = (payload.days || []).length;
  console.log(`refreshLirrSchedule: wrote ${count} day(s) to Firestore`);
  return { ok: true, count };
}

exports.refreshLirrGtfs = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/New_York",
    region: "us-east1",
    memory: "1GiB",
    timeoutSeconds: 180,
  },
  async () => {
    await refreshLirrSchedule({ force: false });
    return null;
  },
);

exports.forceRefreshLirrGtfs = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
    memory: "1GiB",
    timeoutSeconds: 180,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      const result = await refreshLirrSchedule({ force: true });
      res.status(200).json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  },
);

/**
 * Read the cached 14-day payload, preferring Firestore. Falls back to a
 * live fetch + write-through if the doc is missing, version-mismatched, or
 * older than FIRESTORE_MAX_AGE_MS (the scheduled job stopped running).
 */
async function getCachedLirrPayload() {
  const db = admin.firestore();
  const docRef = db.collection(LIRR_CACHE_COLLECTION).doc(LIRR_CACHE_DOC);
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
  const fresh = await buildSchedulePayload(REFRESH_DAYS);
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
      const days = Math.min(14, Math.max(1, parseInt(String(req.query.days || "14"), 10) || 14));
      const now = Date.now();
      if (
        scheduleCache.payload &&
        scheduleCache.days === days &&
        now - scheduleCache.loadedAt < SCHEDULE_TTL_MS
      ) {
        res.set("Cache-Control", "public, max-age=300");
        res.status(200).json(scheduleCache.payload);
        return;
      }
      const fullPayload = await getCachedLirrPayload();
      const payload = sliceDaysFromPayload(fullPayload, days);
      scheduleCache = { payload, loadedAt: now, days };
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
      const days = Math.min(14, Math.max(1, parseInt(String(req.query.days || "14"), 10) || 14));
      const now = Date.now();
      if (
        liveScheduleCache.payload &&
        liveScheduleCache.days === days &&
        now - liveScheduleCache.loadedAt < LIVE_SCHEDULE_TTL_MS
      ) {
        res.set("Cache-Control", "public, max-age=30");
        res.status(200).json(liveScheduleCache.payload);
        return;
      }

      const fullPayload = await getCachedLirrPayload();
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

      liveScheduleCache = { payload, loadedAt: now, days };
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
