/**
 * Build Penn Station (237) ↔ Sayville (204) journeys from LIRR static GTFS.
 * Uses calendar_dates-only service model (current MTA LIRR feed).
 */

const JSZip = require("jszip");
const { parse } = require("csv-parse/sync");

const GTFS_ZIP_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip";
const PENN_ID = "237";
const SAYVILLE_ID = "204";
const GRAND_CENTRAL_ID = "349";
const ATLANTIC_TERMINAL_ID = "241";
const WOODSIDE_ID = "214";

const STATIONS = {
  penn:             { id: PENN_ID,             label: "Penn Station"          },
  "grand-central":  { id: GRAND_CENTRAL_ID,    label: "Grand Central Madison" },
  atlantic:         { id: ATLANTIC_TERMINAL_ID, label: "Atlantic Terminal"    },
  woodside:         { id: WOODSIDE_ID,         label: "Woodside"              },
};
const DEFAULT_MIN_TRANSFER_SEC = 300;
const MAX_JOURNEYS_PER_DAY = 200;

function parseCsv(text) {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  });
}

function timeToSec(t) {
  const [h, m, s] = t.split(":").map((x) => parseInt(x, 10));
  return h * 3600 + m * 60 + s;
}

function secToHhmm(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** YYYY-MM-DD in America/New_York */
function formatYmdNy(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** YYYYMMDD for calendar_dates.txt */
function ymdCompact(ymdDash) {
  return ymdDash.replaceAll("-", "");
}

function weekdayShort(ymdDash) {
  const [y, mo, da] = ymdDash.split("-").map(Number);
  const utcGuess = Date.UTC(y, mo - 1, da, 12, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date(utcGuess));
}

function loadGtfsFromZipBuffer(buf) {
  return JSZip.loadAsync(buf).then((zip) => {
    const read = (name) => zip.file(name).async("string");
    const readOpt = (name) => zip.file(name) ? zip.file(name).async("string") : Promise.resolve(null);
    return Promise.all([
      read("stops.txt"),
      read("trips.txt"),
      read("stop_times.txt"),
      read("calendar_dates.txt"),
      read("feed_info.txt"),
      readOpt("transfers.txt"),
    ]).then(([stopsTxt, tripsTxt, stopTimesTxt, calTxt, feedTxt, transfersTxt]) => ({
      stops: parseCsv(stopsTxt),
      trips: parseCsv(tripsTxt),
      stopTimes: parseCsv(stopTimesTxt),
      calendarDates: parseCsv(calTxt),
      feedInfo: parseCsv(feedTxt)[0] || {},
      transfers: transfersTxt ? parseCsv(transfersTxt) : [],
    }));
  });
}

function activeServiceIdsForDate(calendarDates, ymdCompactStr) {
  const ids = new Set();
  for (const row of calendarDates) {
    if (row.date === ymdCompactStr && row.exception_type === "1") {
      ids.add(row.service_id);
    }
  }
  return ids;
}

function buildTripStopRows(stopTimes) {
  const byTrip = new Map();
  for (const row of stopTimes) {
    if (!byTrip.has(row.trip_id)) byTrip.set(row.trip_id, []);
    byTrip.get(row.trip_id).push(row);
  }
  for (const rows of byTrip.values()) {
    rows.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  }
  return byTrip;
}

function stopNameMap(stops) {
  const m = new Map();
  for (const s of stops) m.set(s.stop_id, s.stop_name);
  return m;
}

function tripMetaMap(trips) {
  const m = new Map();
  for (const t of trips) {
    m.set(t.trip_id, {
      trip_headsign: t.trip_headsign || "",
      trip_short_name: t.trip_short_name || "",
      route_id: t.route_id || "",
    });
  }
  return m;
}

function serviceIdByTripMap(trips) {
  const m = new Map();
  for (const t of trips) m.set(t.trip_id, t.service_id);
  return m;
}

/**
 * Build an index of GTFS transfers.txt for fast lookup during journey building.
 * - transfer_type=1 ("timed"): the departing train is guaranteed to wait; no buffer needed.
 * - transfer_type=2 ("requires minimum transfer time"): use the published min_transfer_time.
 * All other pairs fall back to DEFAULT_MIN_TRANSFER_SEC.
 */
function buildTransfersIndex(transfers) {
  const timed = new Set();
  const stopMin = new Map();
  for (const r of transfers) {
    if (r.transfer_type === "1") {
      timed.add(`${r.from_trip_id}|${r.to_trip_id}|${r.from_stop_id}`);
    } else if (r.transfer_type === "2" && r.min_transfer_time) {
      stopMin.set(`${r.from_stop_id}|${r.to_stop_id}`, Number(r.min_transfer_time));
    }
  }
  return { timed, stopMin };
}

function requiredTransferSec(index, fromTripId, toTripId, stopId, fallback) {
  if (index.timed.has(`${fromTripId}|${toTripId}|${stopId}`)) return 0;
  const key = `${stopId}|${stopId}`;
  if (index.stopMin.has(key)) return index.stopMin.get(key);
  return fallback;
}

/**
 * For each board stop X, list legs (same trip, same service day) from X to destStop.
 */
function legsByBoardStopToDest(tripRows, tripsMeta, serviceByTrip, active, destStop) {
  /** @type {Map<string, Array<{ tripId: string, boardStop: string, destStop: string, dep: string, arr: string, meta: object }>>} */
  const byBoard = new Map();
  for (const [tripId, rows] of tripRows) {
    const trip = tripsMeta.get(tripId);
    if (!trip) continue;
    const svc = serviceByTrip.get(tripId);
    if (!svc || !active.has(svc)) continue;

    const byId = new Map(rows.map((r) => [r.stop_id, r]));
    if (!byId.has(destStop)) continue;
    const seqD = Number(byId.get(destStop).stop_sequence);

    for (const r of rows) {
      const seq = Number(r.stop_sequence);
      if (seq >= seqD) break;
      const boardStop = r.stop_id;
      const leg = {
        tripId,
        boardStop,
        destStop,
        dep: r.departure_time,
        arr: byId.get(destStop).arrival_time,
        meta: trip,
      };
      if (!byBoard.has(boardStop)) byBoard.set(boardStop, []);
      byBoard.get(boardStop).push(leg);
    }
  }
  return byBoard;
}

function buildJourneysForDay({
  tripRows,
  tripsById,
  serviceByTrip,
  active,
  names,
  origin,
  dest,
  minTransferSec,
  transfersIndex,
}) {
  const legsToDest = legsByBoardStopToDest(tripRows, tripsById, serviceByTrip, active, dest);

  const journeys = [];

  for (const [tripId, rows] of tripRows) {
    const tMeta = tripsById.get(tripId);
    if (!tMeta) continue;
    const svc = serviceByTrip.get(tripId);
    if (!svc || !active.has(svc)) continue;

    const byId = new Map(rows.map((r) => [r.stop_id, r]));
    if (!byId.has(origin) || !byId.has(dest)) continue;
    const seqO = Number(byId.get(origin).stop_sequence);
    const seqD = Number(byId.get(dest).stop_sequence);

    if (seqO < seqD) {
      journeys.push({
        depSec: timeToSec(byId.get(origin).departure_time),
        arrSec: timeToSec(byId.get(dest).arrival_time),
        legs: [
          {
            tripId,
            fromStopId: origin,
            toStopId: dest,
            train: tMeta.trip_short_name,
            headsign: tMeta.trip_headsign,
            from: names.get(origin),
            to: names.get(dest),
            dep: byId.get(origin).departure_time,
            arr: byId.get(dest).arrival_time,
          },
        ],
        transferAt: null,
      });
    }
  }

  for (const [tripId1, rows1] of tripRows) {
    const t1 = tripsById.get(tripId1);
    if (!t1) continue;
    const svc1 = serviceByTrip.get(tripId1);
    if (!svc1 || !active.has(svc1)) continue;

    const by1 = new Map(rows1.map((r) => [r.stop_id, r]));
    if (!by1.has(origin)) continue;
    const seqO = Number(by1.get(origin).stop_sequence);

    for (const r of rows1) {
      const seq = Number(r.stop_sequence);
      if (seq <= seqO) continue;
      const X = r.stop_id;
      if (X === dest) break;

      const arrX = timeToSec(r.arrival_time);
      const legs2 = legsToDest.get(X);
      if (!legs2) continue;

      for (const leg2 of legs2) {
        if (leg2.tripId === tripId1) continue;
        const svc2 = serviceByTrip.get(leg2.tripId);
        if (!svc2 || !active.has(svc2)) continue;
        const depX2 = timeToSec(leg2.dep);
        const buf = requiredTransferSec(transfersIndex, tripId1, leg2.tripId, X, minTransferSec);
        if (depX2 < arrX + buf) continue;

        const depPenn = timeToSec(by1.get(origin).departure_time);
        const arrDest = timeToSec(leg2.arr);

        journeys.push({
          depSec: depPenn,
          arrSec: arrDest,
          legs: [
            {
              tripId: tripId1,
              fromStopId: origin,
              toStopId: X,
              train: t1.trip_short_name,
              headsign: t1.trip_headsign,
              from: names.get(origin),
              to: names.get(X),
              dep: by1.get(origin).departure_time,
              arr: r.arrival_time,
            },
            {
              tripId: leg2.tripId,
              fromStopId: X,
              toStopId: dest,
              train: leg2.meta.trip_short_name,
              headsign: leg2.meta.trip_headsign,
              from: names.get(X),
              to: names.get(dest),
              dep: leg2.dep,
              arr: leg2.arr,
            },
          ],
          transferAt: names.get(X),
        });
      }
    }
  }

  journeys.sort((a, b) => a.depSec - b.depSec || a.arrSec - b.arrSec);
  return dedupeByOriginMinute(journeys);
}

function dedupeByOriginMinute(journeys) {
  const best = new Map();
  for (const j of journeys) {
    const minuteKey = Math.floor(j.depSec / 60);
    const prev = best.get(minuteKey);
    if (!prev || j.arrSec < prev.arrSec) best.set(minuteKey, j);
  }
  const list = [...best.values()].sort((a, b) => a.depSec - b.depSec);
  const truncated = list.length > MAX_JOURNEYS_PER_DAY;
  return {
    rows: list.slice(0, MAX_JOURNEYS_PER_DAY).map((j) => ({
      depart: secToHhmm(j.depSec),
      arrive: secToHhmm(j.arrSec),
      durationMin: Math.round((j.arrSec - j.depSec) / 60),
      transferAt: j.transferAt,
      legs: j.legs,
    })),
    truncated,
  };
}

async function fetchGtfsZipBuffer() {
  // Bound the fetch so an upstream stall doesn't hold the function up to its
  // global timeoutSeconds. The zip is ~10 MB; 30 s is generous on a healthy
  // connection and short enough that we fail fast on hangs.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(GTFS_ZIP_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`GTFS download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/**
 * @returns {Promise<object>}
 */
function addCalendarDaysYmd(ymdDash, deltaDays) {
  const [y, m, d] = ymdDash.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return formatYmdNy(dt);
}

async function buildSchedulePayload(numDays = 14, originId = PENN_ID) {
  const buf = await fetchGtfsZipBuffer();
  const gtfs = await loadGtfsFromZipBuffer(buf);
  const names = stopNameMap(gtfs.stops);
  const tripRows = buildTripStopRows(gtfs.stopTimes);
  const tripsById = tripMetaMap(gtfs.trips);
  const serviceByTrip = serviceIdByTripMap(gtfs.trips);
  const transfersIndex = buildTransfersIndex(gtfs.transfers);

  const days = [];
  const startNy = formatYmdNy(new Date());
  for (let i = 0; i < numDays; i++) {
    const ymd = addCalendarDaysYmd(startNy, i);
    const compact = ymdCompact(ymd);
    const active = activeServiceIdsForDate(gtfs.calendarDates, compact);
    if (active.size === 0) {
      days.push({
        date: ymd,
        weekday: weekdayShort(ymd),
        outbound: [],
        inbound: [],
        note: "No service IDs in GTFS calendar_dates for this day (feed may not cover this date yet).",
      });
      continue;
    }

    const outbound = buildJourneysForDay({
      tripRows,
      tripsById,
      serviceByTrip,
      active,
      names,
      origin: originId,
      dest: SAYVILLE_ID,
      minTransferSec: DEFAULT_MIN_TRANSFER_SEC,
      transfersIndex,
    });

    const inbound = buildJourneysForDay({
      tripRows,
      tripsById,
      serviceByTrip,
      active,
      names,
      origin: SAYVILLE_ID,
      dest: originId,
      minTransferSec: DEFAULT_MIN_TRANSFER_SEC,
      transfersIndex,
    });

    days.push({
      date: ymd,
      weekday: weekdayShort(ymd),
      outbound: outbound.rows,
      inbound: inbound.rows,
      truncated: outbound.truncated || inbound.truncated,
    });
  }

  return {
    timezone: "America/New_York",
    source: GTFS_ZIP_URL,
    feedVersion: gtfs.feedInfo.feed_version || "",
    disclaimer:
      "Static schedule from MTA GTFS. /api/lirrScheduleLive merges GTFS-Realtime delays for today (live feed is currently reachable without an API key). Timed transfers (transfer_type=1 in transfers.txt) are honored; 5-min buffer for all others. At most one transfer; up to 200 options per direction per day after deduping by departure minute.",
    stops: {
      origin: { id: originId, name: names.get(originId) },
      sayville: { id: SAYVILLE_ID, name: names.get(SAYVILLE_ID) },
    },
    days,
  };
}

module.exports = {
  buildSchedulePayload,
  GTFS_ZIP_URL,
  formatYmdNy,
  PENN_ID,
  SAYVILLE_ID,
  GRAND_CENTRAL_ID,
  ATLANTIC_TERMINAL_ID,
  WOODSIDE_ID,
  STATIONS,
};
