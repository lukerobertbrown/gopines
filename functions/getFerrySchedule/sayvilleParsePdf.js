/**
 * Parse Sayville Ferry PDF text (pdf-parse) into trip rows.
 * Schedule uses compact times: 7:00A, 3:20P, 12:00N — not matched by generic Vision regex.
 */

/** Order matters: AM/PM/NOON before single A/P/N. No \\b after minutes (e.g. 7:00A). */
const TIME_PATTERN = /(\d{1,2}):(\d{2})(AM|PM|NOON|A|P|N)(?![A-Za-z])/gi;

/**
 * @param {string} hStr
 * @param {string} mStr
 * @param {string} suffixRaw
 */
function to24h(hStr, mStr, suffixRaw) {
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  const suf = suffixRaw.toUpperCase();
  const isNoon = suf === "N" || suf === "NOON";
  const isPm = isNoon || suf.startsWith("P");
  const isAm = suf.startsWith("A") && !isPm;

  if (isNoon) {
    return `12:${String(m).padStart(2, "0")}`;
  }
  if (isAm || suf === "A" || suf === "AM") {
    if (h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  if (isPm || suf === "P" || suf === "PM") {
    if (h !== 12) h += 12;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return null;
}

/**
 * @param {string} line
 * @returns {{ departureTime: string, raw: string }[]}
 */
function extractTimesFromLine(line) {
  const out = [];
  const re = new RegExp(TIME_PATTERN.source, "gi");
  for (const m of line.matchAll(re)) {
    const t24 = to24h(m[1], m[2], m[3]);
    if (t24) out.push({ departureTime: t24, raw: m[0].trim() });
  }
  return out;
}

function dedupeTrips(trips) {
  const seen = new Set();
  const out = [];
  for (const t of trips) {
    const k = `${t.direction}-${t.departureTime}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.sort(
    (a, b) =>
      a.departureTime.localeCompare(b.departureTime) || a.direction.localeCompare(b.direction),
  );
}

/**
 * @param {string} text from pdf-parse
 * @returns {{ trips: object[], parseNotes: string }}
 */
function parseSayvillePdfText(text) {
  if (!text || !text.trim()) {
    return { trips: [], parseNotes: "pdf_empty_text" };
  }

  const lines = text.split(/\r?\n/);
  /** @type {object[]} */
  const trips = [];

  for (const line of lines) {
    const times = extractTimesFromLine(line);
    if (times.length >= 2) {
      trips.push({
        direction: "sayville_to_pines",
        departureTime: times[0].departureTime,
        sourceColumn: "pdf_row_left",
        rawLine: line.trim().slice(0, 200),
      });
      trips.push({
        direction: "pines_to_sayville",
        departureTime: times[1].departureTime,
        sourceColumn: "pdf_row_right",
        rawLine: line.trim().slice(0, 200),
      });
    }
  }

  const deduped = dedupeTrips(trips);
  return {
    trips: deduped,
    parseNotes: `pdf:${deduped.length}_trips_row_pairs`,
  };
}

module.exports = {
  parseSayvillePdfText,
  to24h,
  extractTimesFromLine,
  TIME_PATTERN,
};
