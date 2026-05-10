/**
 * Turn Vision API documentTextDetection fullTextAnnotation into ferry trip rows.
 * Heuristic: left half of page = sayville_to_pines, right = pines_to_sayville (calibrate if layout differs).
 * Time tokens use the same rules as sayvilleParsePdf.js (7:00A, 12:00N, …).
 */

const { extractTimesFromLine } = require("./sayvilleParsePdf");

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
      });
    }
  }
  return { trips: dedupeTrips(trips), parseNotes: "vision_text_fallback" };
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
        const box = word.boundingBox;
        if (!box || !box.vertices || box.vertices.length < 2) continue;
        const verts = box.vertices;
        const cx = verts.reduce((s, v) => s + (v.x || 0), 0) / verts.length;
        const cy = verts.reduce((s, v) => s + (v.y || 0), 0) / verts.length;
        words.push({ text, cx, cy });
      }
    }
  }

  if (words.length === 0) return null;

  words.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const yTol = 14;
  /** @type {{ cy: number, words: typeof words }[]} */
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
  for (const line of lines) {
    line.words.sort((a, b) => a.cx - b.cx);
  }

  const trips = [];

  for (const line of lines) {
    const rowText = line.words.map((w) => w.text).join(" ");
    const avgX = line.words.reduce((s, w) => s + w.cx, 0) / line.words.length;
    const times = extractTimesFromLine(rowText);
    if (times.length >= 2) {
      trips.push({
        direction: "sayville_to_pines",
        departureTime: times[0].departureTime,
        sourceColumn: "geo_row_pair",
        rawLine: rowText.slice(0, 160),
      });
      trips.push({
        direction: "pines_to_sayville",
        departureTime: times[1].departureTime,
        sourceColumn: "geo_row_pair",
        rawLine: rowText.slice(0, 160),
      });
    } else if (times.length === 1) {
      const direction = avgX < midX ? "sayville_to_pines" : "pines_to_sayville";
      trips.push({
        direction,
        departureTime: times[0].departureTime,
        sourceColumn: avgX < midX ? "geo_left" : "geo_right",
        rawLine: rowText.slice(0, 160),
      });
    }
  }

  if (trips.length === 0) return null;
  return { trips: dedupeTrips(trips), parseNotes: "geometry_columns" };
}

/**
 * @param {import('@google-cloud/vision').protos.google.cloud.vision.v1.IAnnotateImageResponse} apiResult
 * @returns {{ trips: object[], parseNotes: string }}
 */
function parseVisionDocumentResult(apiResult) {
  const ann = apiResult.fullTextAnnotation;
  if (!ann) {
    return { trips: [], parseNotes: "no_fullTextAnnotation" };
  }

  const geo = geometryParse(ann);
  if (geo && geo.trips.length > 0) return geo;

  const text = ann.text || "";
  return fallbackTextOnly(text);
}

module.exports = {
  parseVisionDocumentResult,
  wordToText,
};
