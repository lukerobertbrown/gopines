const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { buildSchedulePayload } = require("./pennSayvilleSchedule");

setGlobalOptions({
  region: "us-east1",
  memory: "256MiB",
  timeoutSeconds: 10,
});

const corsOrigins = [/gopines\.gay$/, "http://localhost:5173", "http://127.0.0.1:5173"];

/** @type {{ payload: object | null; loadedAt: number; days: number }} */
let scheduleCache = { payload: null, loadedAt: 0, days: 0 };
const SCHEDULE_TTL_MS = 30 * 60 * 1000;

exports.getLIRRDepartures = onRequest(
  {
    cors: corsOrigins,
    invoker: "public",
  },
  (req, res) => {
    res.status(200).json({ ok: true, message: "placeholder — use getLirrSchedule for static timetable" });
  },
);

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
