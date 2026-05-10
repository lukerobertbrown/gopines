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

const { extractTimesFromLine, to24h } = require("./sayvilleParsePdf");

// Vision OCR sometimes splits "7:00A" into separate tokens ("7", ":", "00A")
// that re-join with spaces; this looser regex accepts whitespace between parts.
function extractTimesLoose(line) {
  const out = [];
  const re = /(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM|NOON|A|P|N)(?![A-Za-z])/gi;
  for (const m of line.matchAll(re)) {
    const t24 = to24h(m[1], m[2], m[3]);
    if (t24) out.push({ departureTime: t24, raw: m[0].trim() });
  }
  return out;
}

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

  // The schedule lays out two page-halves, each independently row-stacked.
  // Vision tends to cluster across both halves (e.g. "MONDAY - WEDNESDAY INCL.
  // SATURDAY" all on one line), so we split words at midX BEFORE clustering
  // into lines. Each half then yields its own day headers, sections, and time
  // rows independently.
  const maxCx = words.reduce((m, w) => Math.max(m, w.cx), 0);
  const pageW = page.width && page.width > 100 ? page.width : maxCx + 60;
  const midX = pageW / 2;

  const trips = [];
  const halves = [
    { xMin: 0, xMax: midX, name: "left" },
    { xMin: midX, xMax: pageW + 200, name: "right" },
  ];

  for (const half of halves) {
    const halfWords = words.filter((w) => w.cx >= half.xMin && w.cx < half.xMax);
    if (halfWords.length === 0) continue;

    const lines = clusterLines(halfWords, 14);
    const dayHeaders = findDayHeaders(lines);

    try {
      console.log(`[parser] half=${half.name} words=${halfWords.length} lines=${lines.length} dayHeaders=${dayHeaders.length}`);
      for (const h of dayHeaders) {
        console.log(`[parser] half=${half.name} header="${h.label}" cy=${Math.round(h.cy)}`);
      }
    } catch (_) { /* ignore */ }

    if (dayHeaders.length === 0) continue;

    const sortedHeaders = dayHeaders.slice().sort((a, b) => a.cy - b.cy);
    const sections = sortedHeaders.map((h, i) => ({
      days: h.days,
      label: h.label,
      yMin: h.cy,
      yMax: i + 1 < sortedHeaders.length ? sortedHeaders[i + 1].cy : Number.POSITIVE_INFINITY,
      xMin: half.xMin,
      xMax: half.xMax,
    }));

    const halfMid = (half.xMin + half.xMax) / 2;

    for (const line of lines) {
      const text = line.words.map((w) => w.text).join(" ");
      if (!/\d/.test(text) && DAY_RE.test(text)) continue;

      const times = extractTimesLoose(text);
      if (times.length === 0) continue;

      const sec = sections.find((s) => line.cy > s.yMin + 4 && line.cy < s.yMax - 4);
      if (!sec) continue;

      if (times.length >= 2) {
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
        const timeWord = line.words.find((w) => /\d{1,2}:\d{2}/.test(w.text));
        const tx = timeWord ? timeWord.cx : (line.words.reduce((s, w) => s + w.cx, 0) / line.words.length);
        const direction = tx < halfMid ? "sayville_to_pines" : "pines_to_sayville";
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
