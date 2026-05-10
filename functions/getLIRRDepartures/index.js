const { onRequest } = require("firebase-functions/v2/https");
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

/** @type {{ payload: object | null; loadedAt: number; days: number }} */
let scheduleCache = { payload: null, loadedAt: 0, days: 0 };
const SCHEDULE_TTL_MS = 30 * 60 * 1000;

/** @type {{ payload: object | null; loadedAt: number; days: number }} */
let liveScheduleCache = { payload: null, loadedAt: 0, days: 0 };
const LIVE_SCHEDULE_TTL_MS = 60 * 1000;

exports.getLIRRDepartures = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
  },
  (req, res) => {
    res.status(200).json({ ok: true, message: "placeholder — use getLirrSchedule or getLirrScheduleLive" });
  },
);

/** Static GTFS only — no secrets required. */
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
      const payload = await buildSchedulePayload(days);
      scheduleCache = { payload, loadedAt: now, days };
      res.set("Cache-Control", "public, max-age=300");
      res.status(200).json(payload);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e && e.message ? e.message : e) });
    }
  },
);

/** Static schedule + MTA GTFS-Realtime delays for today (fetched keyless; optional key supported in fetch helper if MTA requires it later). */
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

      const rtBuf = await fetchLirrGtfsRt();
      const feed = decodeFeed(rtBuf);
      const index = buildTripRealtimeIndex(feed);
      const payload = await buildSchedulePayload(days);
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
