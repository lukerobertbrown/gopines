/**
 * MTA LIRR GTFS-Realtime (protobuf) — https://api-endpoint.mta.info/…/gtfs-lirr
 */

const gtfsRt = require("gtfs-realtime-bindings");

const GTFS_RT_URL =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr";

const FeedMessage = gtfsRt.transit_realtime.FeedMessage;

function numOr0(x) {
  if (x == null) return 0;
  if (typeof x === "object" && typeof x.toNumber === "function") return x.toNumber();
  return Number(x) || 0;
}

/**
 * MTA currently serves this URL with HTTP 200 and no auth (no `x-api-key`).
 * If they start requiring a key, pass a non-empty optionalApiKey to send the header.
 *
 * @param {string} [optionalApiKey]
 * @returns {Promise<Buffer>}
 */
async function fetchLirrGtfsRt(optionalApiKey) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (optionalApiKey && String(optionalApiKey).trim()) {
    headers["x-api-key"] = String(optionalApiKey).trim();
  }
  // Bound the fetch — realtime feed should respond in well under 5 s.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(GTFS_RT_URL, {
      ...(Object.keys(headers).length ? { headers } : {}),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MTA GTFS-RT ${res.status}: ${text.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {Buffer} buf
 */
function decodeFeed(buf) {
  return FeedMessage.decode(buf);
}

/**
 * Per trip_id: trip-level delay + max delay per stop_id from stop_time_updates.
 * @returns {Map<string, { tripDelaySec: number, stopDelaySec: Map<string, number> }>}
 */
function buildTripRealtimeIndex(feed) {
  /** @type {Map<string, { tripDelaySec: number, stopDelaySec: Map<string, number> }>} */
  const map = new Map();

  for (const ent of feed.entity || []) {
    const tu = ent.tripUpdate;
    if (!tu || !tu.trip) continue;
    const tripId = tu.trip.tripId;
    if (!tripId) continue;

    let tripDelaySec = tu.delay != null ? numOr0(tu.delay) : 0;

    /** @type {Map<string, number>} */
    const stopDelaySec = new Map();

    for (const stu of tu.stopTimeUpdate || []) {
      let d = 0;
      if (stu.departure && stu.departure.delay != null) d = Math.max(d, numOr0(stu.departure.delay));
      if (stu.arrival && stu.arrival.delay != null) d = Math.max(d, numOr0(stu.arrival.delay));
      if (d > 0 && stu.stopId) {
        const prev = stopDelaySec.get(stu.stopId) || 0;
        stopDelaySec.set(stu.stopId, Math.max(prev, d));
      }
    }

    const prev = map.get(tripId);
    if (!prev) {
      map.set(tripId, { tripDelaySec, stopDelaySec });
      continue;
    }
    prev.tripDelaySec = Math.max(prev.tripDelaySec, tripDelaySec);
    for (const [sid, sec] of stopDelaySec) {
      const p = prev.stopDelaySec.get(sid) || 0;
      prev.stopDelaySec.set(sid, Math.max(p, sec));
    }
  }

  return map;
}

function delayForLeg(index, tripId, fromStopId, toStopId) {
  const row = index.get(tripId);
  if (!row) return null;
  const fromD = row.stopDelaySec.get(fromStopId);
  const toD = row.stopDelaySec.get(toStopId);
  const parts = [];
  if (fromD != null) parts.push(fromD);
  if (toD != null) parts.push(toD);
  if (row.tripDelaySec > 0) parts.push(row.tripDelaySec);
  if (!parts.length) return null;
  return Math.max(...parts);
}

/**
 * Attach delaySec / delayMin to legs; set journey maxDelaySec. Only mutates `todayYmd` day blocks.
 * @param {object} payload from buildSchedulePayload
 * @param {Map} index from buildTripRealtimeIndex
 * @param {string} todayYmd YYYY-MM-DD
 */
function mergeRealtimeIntoPayload(payload, index, todayYmd) {
  for (const day of payload.days || []) {
    if (day.date !== todayYmd) continue;
    for (const dir of ["outbound", "inbound"]) {
      for (const j of day[dir] || []) {
        let maxD = 0;
        for (const leg of j.legs || []) {
          const d = delayForLeg(index, leg.tripId, leg.fromStopId, leg.toStopId);
          if (d != null && d > 0) {
            leg.delaySec = d;
            leg.delayMin = Math.round(d / 60);
            maxD = Math.max(maxD, d);
          }
        }
        if (maxD > 0) {
          j.maxDelaySec = maxD;
          j.maxDelayMin = Math.round(maxD / 60);
        }
      }
    }
  }
}

/**
 * Compact JSON for debugging / inspection.
 */
function feedToSummaryJson(feed, maxTripUpdates = 150) {
  const headerTs = feed.header && feed.header.timestamp != null ? numOr0(feed.header.timestamp) : null;
  const out = [];
  for (const ent of feed.entity || []) {
    if (out.length >= maxTripUpdates) break;
    const tu = ent.tripUpdate;
    if (!tu || !tu.trip || !tu.trip.tripId) continue;
    const stops = (tu.stopTimeUpdate || [])
      .filter((s) => s.stopId)
      .slice(0, 12)
      .map((s) => ({
        stopId: s.stopId,
        depDelay: s.departure && s.departure.delay != null ? numOr0(s.departure.delay) : undefined,
        arrDelay: s.arrival && s.arrival.delay != null ? numOr0(s.arrival.delay) : undefined,
      }));
    out.push({
      tripId: tu.trip.tripId,
      routeId: tu.trip.routeId || undefined,
      startDate: tu.trip.startDate || undefined,
      tripDelaySec: tu.delay != null ? numOr0(tu.delay) : undefined,
      stopTimeUpdates: stops,
    });
  }
  return {
    url: GTFS_RT_URL,
    headerTimestamp: headerTs,
    tripUpdateSample: out,
    totalEntities: (feed.entity || []).length,
  };
}

module.exports = {
  GTFS_RT_URL,
  fetchLirrGtfsRt,
  decodeFeed,
  buildTripRealtimeIndex,
  mergeRealtimeIntoPayload,
  feedToSummaryJson,
};
