/**
 * Turn Vision API documentTextDetection fullTextAnnotation into ferry trip rows
 * tagged with day-of-week ranges. The Sayville → Fire Island Pines schedule
 * is laid out as a 2D grid of day-of-week sections (e.g. MONDAY – WEDNESDAY,
 * THURSDAY, FRIDAY in the left page-half; SATURDAY, SUNDAY in the right
 * page-half), each with two sub-columns: Leave Sayville | Leave F.I. Pines.
 *
 * Algorithm:
 *   1. Cluster Vision words into lines by Y position.
 *   2. Find day-of-week section headers (uppercase, no digits — to avoid
 *      matching the title-case schedule date range).
 *   3. Cluster headers into page columns at midX, then build a section bbox
 *      per header that runs from its Y to the next-header-Y in the same column.
 *   4. For each line that contains times, find its owning section, then assign
 *      direction by sub-column: 2 times in a line → time[0]=sayville_to_pines,
 *      time[1]=pines_to_sayville; 1 time → use X relative to section midX.
 *   5. Each trip carries `daysOfWeek: number[]` (JS day index, Sun=0..Sat=6)
 *      and a human `dayLabel`.
 */

const { extractTimesFromLine } = require("./sayvilleParsePdf");

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
// Case-sensitive: matches the all-caps headers (MONDAY, THURSDAY, etc.) but
// NOT title-case mentions like "Friday, April 17 thru Wednesday, May 20".
const DAY_RE = /\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)(?:\s*[-‐-―]\s*(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY))?/;

function dayIndex(name) {
  return DAY_NAMES.indexOf(name.toUpperCase());
}

function expandDayRange(startName, endName) {
  const s = dayIndex(startName);
  const e = endName ? dayIndex(endName) : s;
  if (s < 0 || e < 0) return [];
  const out = [];
  if (s <= e) {
    for (let i = s; i <= e; i++) out.push(i);
  } else {
    for (let i = s; i <= 6; i++) out.push(i);
    for (let i = 0; i <= e; i++) out.push(i);
  }
  return out;
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s|-)([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/**
 * @param {import('@google-cloud/vision').protos.google.cloud.vision.v1.IWord} word
 */
function wordToText(word) {
  if (word.text && typeof word.text === "string") return word.text;
  if (!word.symbols || !word.symbols.length) return "";
  return word.symbols.map((s) => s.text || "").join("");
}

function dedupeTrips(trips) {
  const seen = new Set();
  const out = [];
  for (const t of trips) {
    const key = `${t.direction}-${t.departureTime}-${(t.daysOfWeek || []).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => {
    const aMin = Math.min(...(a.daysOfWeek || [99]));
    const bMin = Math.min(...(b.daysOfWeek || [99]));
    if (aMin !== bMin) return aMin - bMin;
    if (a.direction !== b.direction) return a.direction.localeCompare(b.direction);
    return a.departureTime.localeCompare(b.departureTime);
  });
}

/**
 * @param {string} text
 */
function fallbackTextOnly(text) {
  const trips = [];
  for (const line of text.split(/\n/)) {
    const times = extractTimesFromLine(line);
    for (const t of times) {
      trips.push({
        direction: "unknown",
        departureTime: t.departureTime,
        sourceColumn: "unknown",
        rawLine: line.trim().slice(0, 120),
        daysOfWeek: null,
        dayLabel: null,
      });
    }
  }
  return { trips: dedupeTrips(trips), parseNotes: "vision_text_fallback" };
}

function clusterLines(words, yTol) {
  words.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const lines = [];
  for (const w of words) {
    let line = lines.find((l) => Math.abs(l.cy - w.cy) < yTol);
    if (!line) {
      line = { cy: w.cy, words: [] };
      lines.push(line);
    }
    line.words.push(w);
    line.cy = (line.cy * (line.words.length - 1) + w.cy) / line.words.length;
  }
  lines.sort((a, b) => a.cy - b.cy);
  for (const line of lines) line.words.sort((a, b) => a.cx - b.cx);
  return lines;
}

function findDayHeaders(lines) {
  const headers = [];
  for (const line of lines) {
    const text = line.words.map((w) => w.text).join(" ").trim();
    // Day-of-week section headers contain no digits and no slashes.
    // The title's "Friday, April 17 thru Wednesday, May 20" has digits — skip.
    if (/\d/.test(text)) continue;
    const m = text.match(DAY_RE);
    if (!m) continue;
    const days = expandDayRange(m[1], m[2]);
    if (!days.length) continue;
    const cx = line.words.reduce((s, w) => s + w.cx, 0) / line.words.length;
    const label = m[2] ? `${titleCase(m[1])} – ${titleCase(m[2])}` : titleCase(m[1]);
    headers.push({ days, cy: line.cy, cx, label });
  }
  return headers;
}

function buildSections(headers, xMin, xMax) {
  return headers.map((h, i) => ({
    days: h.days,
    label: h.label,
    yMin: h.cy,
    yMax: i + 1 < headers.length ? headers[i + 1].cy : Number.POSITIVE_INFINITY,
    xMin,
    xMax,
  }));
}

function findOwningSection(lineCy, lineCx, sections) {
  for (const s of sections) {
    if (lineCy > s.yMin + 4 && lineCy < s.yMax - 4 && lineCx >= s.xMin && lineCx < s.xMax) {
      return s;
    }
  }
  return null;
}

/**
 * @param {import('@google-cloud/vision').protos.google.cloud.vision.v1.IFullTextAnnotation} ann
 */
function geometryParse(ann) {
  const page = ann.pages && ann.pages[0];
  if (!page) return null;

  const pageW = page.width || 1000;
  const midX = pageW / 2;

  /** @type {{ text: string, cx: number, cy: number }[]} */
  const words = [];
  for (const block of page.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const word of para.words || []) {
        const text = wordToText(word);
        if (!text.trim()) continue;
        const verts = (word.boundingBox && word.boundingBox.vertices) || [];
        if (verts.length < 2) continue;
        const cx = verts.reduce((s, v) => s + (v.x || 0), 0) / verts.length;
        const cy = verts.reduce((s, v) => s + (v.y || 0), 0) / verts.length;
        words.push({ text, cx, cy });
      }
    }
  }

  if (words.length === 0) return null;

  const lines = clusterLines(words, 14);
  const dayHeaders = findDayHeaders(lines);
  if (dayHeaders.length === 0) return null;

  const leftHeaders = dayHeaders.filter((h) => h.cx < midX).sort((a, b) => a.cy - b.cy);
  const rightHeaders = dayHeaders.filter((h) => h.cx >= midX).sort((a, b) => a.cy - b.cy);
  const sections = [
    ...buildSections(leftHeaders, 0, midX),
    ...buildSections(rightHeaders, midX, pageW + 100),
  ];

  const trips = [];

  for (const line of lines) {
    const text = line.words.map((w) => w.text).join(" ");
    // Skip header-only lines (no digits, day name match).
    if (!/\d/.test(text) && DAY_RE.test(text)) continue;

    const times = extractTimesFromLine(text);
    if (times.length === 0) continue;

    const lineCx = line.words.reduce((s, w) => s + w.cx, 0) / line.words.length;
    const sec = findOwningSection(line.cy, lineCx, sections);
    if (!sec) continue;

    if (times.length >= 2) {
      // Two columns in one row: time[0] = leftmost = sayville_to_pines.
      trips.push({
        daysOfWeek: sec.days,
        dayLabel: sec.label,
        direction: "sayville_to_pines",
        departureTime: times[0].departureTime,
        sourceColumn: "left",
        rawLine: text.slice(0, 160),
      });
      trips.push({
        daysOfWeek: sec.days,
        dayLabel: sec.label,
        direction: "pines_to_sayville",
        departureTime: times[1].departureTime,
        sourceColumn: "right",
        rawLine: text.slice(0, 160),
      });
    } else {
      // Single time on the line — use X-position vs section midpoint.
      const sectionMidX = (sec.xMin + sec.xMax) / 2;
      const timeWord = line.words.find((w) => /\d{1,2}:\d{2}/.test(w.text));
      const tx = timeWord ? timeWord.cx : lineCx;
      const direction = tx < sectionMidX ? "sayville_to_pines" : "pines_to_sayville";
      trips.push({
        daysOfWeek: sec.days,
        dayLabel: sec.label,
        direction,
        departureTime: times[0].departureTime,
        sourceColumn: direction === "sayville_to_pines" ? "left" : "right",
        rawLine: text.slice(0, 160),
      });
    }
  }

  if (trips.length === 0) return null;
  return { trips: dedupeTrips(trips), parseNotes: "geometry_day_aware" };
}

/**
 * @param {import('@google-cloud/vision').protos.google.cloud.vision.v1.IAnnotateImageResponse} apiResult
 * @returns {{ trips: object[], parseNotes: string }}
 */
function parseVisionDocumentResult(apiResult) {
  const ann = apiResult.fullTextAnnotation;
  if (!ann) return { trips: [], parseNotes: "no_fullTextAnnotation" };

  const geo = geometryParse(ann);
  if (geo && geo.trips.length > 0) return geo;

  const text = ann.text || "";
  return fallbackTextOnly(text);
}

module.exports = {
  parseVisionDocumentResult,
  wordToText,
  expandDayRange,
  DAY_NAMES,
};
