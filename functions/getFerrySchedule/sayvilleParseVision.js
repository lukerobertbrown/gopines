/**
 * Turn Vision API documentTextDetection fullTextAnnotation into ferry trip rows.
 * Heuristic: left half of page = sayville_to_pines, right = pines_to_sayville (calibrate if layout differs).
 */

/**
 * @param {import('@google-cloud/vision').protos.google.cloud.vision.v1.IWord} word
 */
function wordToText(word) {
  if (word.text && typeof word.text === "string") return word.text;
  if (!word.symbols || !word.symbols.length) return "";
  return word.symbols.map((s) => s.text || "").join("");
}

/**
 * @param {string} hStr
 * @param {string} mStr
 * @param {string | null | undefined} ap
 */
function to24h(hStr, mStr, ap) {
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (ap) {
    const AP = ap.toUpperCase();
    if (AP === "PM" && h < 12) h += 12;
    if (AP === "AM" && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
  const re = /\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const time24 = to24h(m[1], m[2], m[3]);
    if (!time24) continue;
    trips.push({
      direction: "unknown",
      departureTime: time24,
      sourceColumn: "unknown",
      rawLine: null,
    });
  }
  return { trips: dedupeTrips(trips), parseNotes: "text_fallback" };
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
  const timePattern = /\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\b/gi;

  for (const line of lines) {
    const rowText = line.words.map((w) => w.text).join(" ");
    const avgX = line.words.reduce((s, w) => s + w.cx, 0) / line.words.length;
    const column = avgX < midX ? "left" : "right";
    const direction = column === "left" ? "sayville_to_pines" : "pines_to_sayville";
    for (const match of rowText.matchAll(timePattern)) {
      const time24 = to24h(match[1], match[2], match[3]);
      if (!time24) continue;
      trips.push({
        direction,
        departureTime: time24,
        sourceColumn: column,
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
  to24h,
};
