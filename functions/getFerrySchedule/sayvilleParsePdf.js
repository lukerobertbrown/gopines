/**
 * Positional PDF parser for the Sayville Ferry — Fire Island Pines schedule.
 *
 * Why we parse the PDF in addition to the PNG (Vision OCR):
 *   - PDF text items carry exact (x, y) positions, so we can correlate
 *     STARTS / ENDS / ONLY date annotations with the specific trip rows
 *     they sit next to. OCR loses that adjacency.
 *   - The triangle (▲) marker comes through pdf-parse as the literal "p"
 *     glyph (font substitution) immediately preceding each marked time.
 *     OCR drops most of these, so the PDF is the source of truth here.
 *   - The PDF often contains MULTIPLE seasonal schedules. We scope to
 *     the one matching the active schedule's title (typically the
 *     scheduleTitle the Vision parser already extracted from the PNG).
 *
 * The parser fetches positional text via pdf-parse's `pagerender` hook,
 * groups items into per-schedule "blocks" by clustering similar X, then
 * walks each block top-to-bottom finding day-of-week headers and the
 * time rows that follow them. Each row's two times become a
 * sayville_to_pines / pines_to_sayville trip pair tagged with
 * `extraStops` (a "p" preceding the time at the same Y) and either
 * `effectiveStart` or `effectiveEnd` (a STARTS/BEGINS or
 * ENDS/UNTIL/THROUGH date annotation whose date item Y is closest to
 * the row's Y within ~10 PDF units in the same X cluster).
 */

// pdf-parse is required lazily (inside readPositionalItems) so that importing
// this module for its pure parsing helpers — e.g. in unit tests — doesn't pull
// in the PDF runtime, which only the positional reader actually needs.

/** Loose time regex — handles "7:00A", "12:00N", "8:30 PM", etc. */
const TIME_PATTERN = /(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM|NOON|A|P|N)(?![A-Za-z])/gi;

const MONTH_LOOKUP = {
  JAN: 1, JANUARY: 1,
  FEB: 2, FEBRUARY: 2,
  MAR: 3, MARCH: 3,
  APR: 4, APRIL: 4,
  MAY: 5,
  JUN: 6, JUNE: 6,
  JUL: 7, JULY: 7,
  AUG: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OCT: 10, OCTOBER: 10,
  NOV: 11, NOVEMBER: 11,
  DEC: 12, DECEMBER: 12,
};

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
/** Quick test for any day name (including plural forms like MONDAYS). */
const HAS_DAY_RE = /\b(?:SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)S?\b/i;

function expandDayRange(startName, endName) {
  const s = DAY_NAMES.indexOf(startName.toUpperCase());
  const e = endName ? DAY_NAMES.indexOf(endName.toUpperCase()) : s;
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

/**
 * Extract JS day indices (0=Sun…6=Sat) from a day-of-week header string.
 * Handles all observed Sayville schedule formats:
 *   - Single:           "FRIDAY", "MONDAYS"
 *   - Dash range:       "MONDAY - WEDNESDAY", "MONDAY–WEDNESDAY"
 *   - Ampersand union:  "SATURDAY & SUNDAY", "TUESDAYS & WEDNESDAYS"
 *   - Comma union:      "SATURDAYS, SUNDAYS & HOLIDAYS" (non-day words ignored)
 * Returns null if no day name is found.
 */
function parseDaysFromHeader(text) {
  const upper = text.toUpperCase();
  const re = /\b(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)S?\b/g;
  const found = [];
  let m;
  while ((m = re.exec(upper)) !== null) {
    found.push({ name: m[1], index: m.index, end: m.index + m[0].length });
  }
  if (found.length === 0) return null;

  const days = new Set();
  let i = 0;
  while (i < found.length) {
    const cur = found[i];
    if (i + 1 < found.length) {
      const between = upper.slice(cur.end, found[i + 1].index);
      if (/[-–—‐]/.test(between)) {
        for (const d of expandDayRange(cur.name, found[i + 1].name)) days.add(d);
        i += 2;
        continue;
      }
    }
    days.add(DAY_NAMES.indexOf(cur.name));
    i++;
  }

  const result = [...days].sort((a, b) => a - b);
  return result.length > 0 ? result : null;
}

/** Build a human-readable label from a sorted days array. */
function daysToLabel(days) {
  if (!days || days.length === 0) return null;
  if (days.length === 1) return titleCase(DAY_NAMES[days[0]]);
  // Contiguous range of 3+ days → "Monday – Wednesday"
  let contiguous = true;
  for (let i = 1; i < days.length; i++) {
    if (days[i] !== days[i - 1] + 1) { contiguous = false; break; }
  }
  if (contiguous && days.length > 2) {
    return `${titleCase(DAY_NAMES[days[0]])} – ${titleCase(DAY_NAMES[days[days.length - 1]])}`;
  }
  return days.map((d) => titleCase(DAY_NAMES[d])).join(" & ");
}

/**
 * @param {string} hStr
 * @param {string} mStr
 * @param {string} suffixRaw
 */
function to24h(hStr, mStr, suffixRaw) {
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const suf = (suffixRaw || "").toUpperCase();
  const isNoon = suf === "N" || suf === "NOON";
  const isPm = isNoon || suf.startsWith("P");
  const isAm = suf.startsWith("A") && !isPm;
  if (isNoon) return `12:${String(m).padStart(2, "0")}`;
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

function extractTimesFromLine(line) {
  const out = [];
  const re = new RegExp(TIME_PATTERN.source, "gi");
  for (const m of line.matchAll(re)) {
    const t24 = to24h(m[1], m[2], m[3]);
    if (t24) out.push({ departureTime: t24, raw: m[0].trim() });
  }
  return out;
}

/** Parse a "MAY 11" / "APRIL 25" / "MAY 11, 2026" string into { month, day }. */
function parseMonthDay(text) {
  const m = (text || "").trim().toUpperCase()
    .match(/\b(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEPT?(?:EMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\.?\s+(\d{1,2})\b/);
  if (!m) return null;
  const month = MONTH_LOOKUP[m[1]];
  const day = parseInt(m[2], 10);
  if (!month || Number.isNaN(day) || day < 1 || day > 31) return null;
  return { month, day };
}

function toIso(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Walks PDF text content via pdf-parse's pagerender hook, returning an array
 * of { x, y, str } for every text run on every page.
 */
async function readPositionalItems(pdfBuffer) {
  const pdfParse = require("pdf-parse");
  /** @type {{ x: number, y: number, str: string }[]} */
  const items = [];
  function pagerender(pageData) {
    return pageData.getTextContent().then((tc) => {
      for (const it of tc.items || []) {
        const tx = it.transform && it.transform[4];
        const ty = it.transform && it.transform[5];
        if (typeof tx !== "number" || typeof ty !== "number") continue;
        const str = (it.str || "").trim();
        if (!str) continue;
        items.push({ x: Math.round(tx), y: Math.round(ty), str });
      }
      return ""; // we don't need the joined text output
    });
  }
  await pdfParse(pdfBuffer, { pagerender });
  return items;
}

/** Round x into a small bucket so we can find runs of times sharing a column. */
function xBucket(x) { return Math.round(x / 8) * 8; }

/**
 * Cluster the page's "SCHEDULE" titles into visual columns, snap boundaries
 * to the largest empty X gap between adjacent column centers, and return only
 * the columns that belong to the *active* scheduleTitle. Including inactive
 * columns in the boundary computation prevents content from neighboring
 * schedules (Early Spring, Spring, …) from leaking into the active block.
 */
function findActiveBlocks(items, scheduleTitle) {
  if (!scheduleTitle) return [];
  const tokens = scheduleTitle
    .split(/\s+/)
    .slice(0, 2)
    .map((t) => t.toUpperCase().replace(/[^A-Z]/g, ""));
  const phrase = tokens.filter(Boolean).join(" ").trim();
  if (!phrase) return [];

  const norm = (s) => s.toUpperCase().replace(/[^A-Z\s]/g, "").replace(/\s+/g, " ").trim();
  // A "schedule title" must contain the word SCHEDULE in uppercase AND a 4-digit year,
  // so footer prose like "Note: ... train schedule is ..." or "SCHEDULE SUBJECT TO …"
  // doesn't get mistaken for a column anchor.
  const isAnyScheduleTitle = (s) =>
    /\bSCHEDULE\b/.test(s) && /\b20\d{2}\b/.test(s);
  const isActiveTitle = (s) => {
    const u = norm(s);
    return u === phrase || u.startsWith(phrase + " ");
  };

  // Step 1: collect every title-line (any season). We need them all so the
  // column boundaries account for the position of every schedule on the
  // page, not just the active one.
  const allTitleItems = items.filter(
    (it) => isAnyScheduleTitle(it.str) || isActiveTitle(it.str),
  );
  if (allTitleItems.length === 0) return [];

  // Step 2: cluster all titles by X (≤ 80 jitter → same column).
  /** @type {{ xCenter: number, items: typeof allTitleItems, hasActive: boolean }[]} */
  const cols = [];
  for (const t of allTitleItems) {
    let col = cols.find((c) => Math.abs(c.xCenter - t.x) < 80);
    if (!col) {
      col = { xCenter: t.x, items: [], hasActive: false };
      cols.push(col);
    }
    col.items.push(t);
    col.xCenter = col.items.reduce((s, x) => s + x.x, 0) / col.items.length;
    if (isActiveTitle(t.str)) col.hasActive = true;
  }
  cols.sort((a, b) => a.xCenter - b.xCenter);

  // Step 3: assign each column a wide preliminary X range, then snap shared
  // boundaries to the largest empty X gap between consecutive column
  // centers. Boundaries snap-fit between *every* pair of adjacent columns
  // (not only active-vs-active), so an active column adjacent to an inactive
  // column still excludes the inactive content.
  const blocks = cols.map((c) => ({
    xCenter: c.xCenter,
    xMin: c.xCenter - 600,
    xMax: c.xCenter + 600,
    yMax: Math.min(...c.items.map((it) => it.y)) - 5,
    hasActive: c.hasActive,
  }));
  for (let i = 0; i < blocks.length - 1; i++) {
    const left = blocks[i];
    const right = blocks[i + 1];
    const xs = items
      .filter((it) => it.x > left.xCenter && it.x < right.xCenter)
      .map((it) => it.x)
      .sort((a, b) => a - b);
    let bestGap = 0;
    let bestMid = (left.xCenter + right.xCenter) / 2;
    for (let j = 0; j < xs.length - 1; j++) {
      const gap = xs[j + 1] - xs[j];
      if (gap > bestGap) {
        bestGap = gap;
        bestMid = (xs[j] + xs[j + 1]) / 2;
      }
    }
    left.xMax = bestMid;
    right.xMin = bestMid;
  }

  // Step 4: keep only the active columns.
  return blocks.filter((b) => b.hasActive);
}

/** Return items inside any of the given blocks. */
function itemsInBlocks(items, blocks) {
  if (blocks.length === 0) return [];
  return items.filter((it) =>
    blocks.some((b) => it.x >= b.xMin && it.x <= b.xMax && it.y < b.yMax),
  );
}

/**
 * Walk items in reading order (top-to-bottom by Y desc, then left-to-right by
 * X asc) and return rows of items at the same Y. yTol controls clustering.
 */
function rowsByY(items, yTol = 4) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  /** @type {{ y: number, items: typeof items }[]} */
  const rows = [];
  for (const it of sorted) {
    let row = rows.find((r) => Math.abs(r.y - it.y) < yTol);
    if (!row) {
      row = { y: it.y, items: [] };
      rows.push(row);
    }
    row.items.push(it);
    row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length;
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * Find day-of-week section starts inside a block by walking rows top-to-
 * bottom. Returns each header with its yStart and yEnd boundary (where
 * yEnd is the Y of the next header, or -Infinity for the last section).
 */
function findDaySections(rows) {
  const sections = [];
  for (const row of rows) {
    if (row.items.length === 0) continue;
    const text = row.items.map((it) => it.str).join(" ").trim();
    // Skip rows containing digits (avoids the schedule's title-case date range).
    if (/\d/.test(text)) continue;
    const days = parseDaysFromHeader(text);
    if (!days) continue;
    sections.push({ days, label: daysToLabel(days), yStart: row.y, yEnd: -Infinity });
  }
  // Set yEnd as the Y of the next section (sections are ordered top-down by
  // Y desc, so the next section has a smaller Y).
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].yEnd = sections[i + 1].yStart;
  }
  return sections;
}

function titleCase(s) {
  return (s || "").toLowerCase()
    .replace(/(^|\s|-)([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/**
 * Locate "STARTS"/"BEGINS"/"ENDS"/"UNTIL"/"THROUGH"/"ONLY" annotations
 * inside a block and pair each with its date. The PDF places the keyword
 * and its date as separate text items at slightly different Ys; we scan
 * within ±15 Y-units and the same X-cluster to pair them.
 *
 * Returns annotations of shape:
 *   { kind: 'start' | 'end' | 'only', isoDateMonth, isoDateDay, x, y }
 * where (x, y) is the date item's centroid (used later to attach to
 * the closest time row).
 */
function findEffectiveAnnotations(items) {
  const startKw = /^(STARTS|BEGINS|BEGINNING|EFF\.?|EFFECTIVE|FROM)$/i;
  const endKw = /^(ENDS|UNTIL|THROUGH|THRU|LAST)$/i;
  const onlyKw = /^(ONLY)$/i;

  const annots = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const upper = it.str.toUpperCase();
    const kindRaw = startKw.test(upper) ? "start"
                  : endKw.test(upper) ? "end"
                  : onlyKw.test(upper) ? "only"
                  : null;
    if (!kindRaw) continue;

    // Pair the keyword with the closest date item nearby (within ±18 Y,
    // ±80 X). For START/END keywords the date is rendered BELOW the keyword
    // (smaller PDF y); for ONLY the date is ABOVE. Prefer the matching
    // direction; if no candidate fits the preferred direction, fall back to
    // any nearby date.
    const preferBelow = kindRaw === "start" || kindRaw === "end";
    let bestPos = null;
    let bestD = Infinity;
    const accept = (cand, requireDir) => {
      const dy = Math.abs(cand.y - it.y);
      const dx = Math.abs(cand.x - it.x);
      if (dy > 18 || dx > 80) return;
      const md = parseMonthDay(cand.str);
      if (!md) return;
      if (requireDir === "below" && cand.y >= it.y) return;
      if (requireDir === "above" && cand.y <= it.y) return;
      if (dy < bestD) {
        bestD = dy;
        bestPos = { ...md, x: cand.x, y: cand.y };
      }
    };
    const dir = preferBelow ? "below" : "above";
    for (let j = 0; j < items.length; j++) if (j !== i) accept(items[j], dir);
    if (!bestPos) {
      for (let j = 0; j < items.length; j++) if (j !== i) accept(items[j], null);
    }
    if (!bestPos) continue;
    annots.push({ kind: kindRaw, month: bestPos.month, day: bestPos.day, x: bestPos.x, y: bestPos.y });
  }
  return annots;
}

/**
 * Snap each annotation to the time row whose Y is closest within ±10 units
 * AND whose items overlap the annotation's X cluster (so a left-half
 * "STARTS MAY 11" doesn't accidentally tag a right-half row).
 */
function attachAnnotationsToRows(rows, annots) {
  /** @type {Map<{y:number}, { startMonth?: number, startDay?: number, endMonth?: number, endDay?: number, onlyMonth?: number, onlyDay?: number }>} */
  const byRow = new Map();
  // Only attach to rows that actually contain a time — otherwise the
  // annotation can snap to a row that's just the date item itself (which
  // sits at the *exact* Y of the annotation and so wins on closeness).
  const timeRows = rows.filter((r) => r.items.some((it) => /\d{1,2}\s*:\s*\d{2}/.test(it.str)));
  // Margin around a row's time-token X span. The date item sits in the same
  // sub-column as the time it qualifies, so its centroid should land within
  // (or just beside) that column — not merely "within 200 units", which could
  // bleed a left-column date onto a right-column boat and wrongly filter it.
  const X_MARGIN = 60;
  for (const ann of annots) {
    let bestRow = null;
    let bestD = Infinity;
    for (const row of timeRows) {
      const dy = Math.abs(row.y - ann.y);
      if (dy > 8) continue;
      // The annotation's X must fall within this row's time-token X span (±margin).
      const timeXs = row.items
        .filter((it) => /\d{1,2}\s*:\s*\d{2}/.test(it.str))
        .map((it) => it.x);
      if (timeXs.length === 0) continue;
      const xMin = Math.min(...timeXs) - X_MARGIN;
      const xMax = Math.max(...timeXs) + X_MARGIN;
      if (ann.x < xMin || ann.x > xMax) continue;
      if (dy < bestD) { bestD = dy; bestRow = row; }
    }
    if (!bestRow) continue;
    const e = byRow.get(bestRow) || {};
    if (ann.kind === "start") { e.startMonth = ann.month; e.startDay = ann.day; }
    else if (ann.kind === "end") { e.endMonth = ann.month; e.endDay = ann.day; }
    else if (ann.kind === "only") { e.onlyMonth = ann.month; e.onlyDay = ann.day; }
    byRow.set(bestRow, e);
  }
  return byRow;
}

/**
 * Given a row of items and the day-section it belongs to, extract its
 * trip pair (sayville_to_pines + pines_to_sayville). Returns { trips, hasP }
 * where each trip has { direction, departureTime, extraStops }.
 */
function extractRowTrips(row) {
  // Build a list of time tokens with their X (so we can split into
  // left/right sub-columns). The PDF often splits "1:00P" into two items
  // ("1:00", "P") sharing a Y — handle that by searching for the suffix in
  // the next item.
  /** @type {{ time: string, x: number }[]} */
  const times = [];
  for (let i = 0; i < row.items.length; i++) {
    const it = row.items[i];
    let s = it.str;
    // Look ahead one item if the time is split before the suffix.
    if (/\d{1,2}\s*:\s*\d{2}\s*$/.test(s) && i + 1 < row.items.length) {
      const next = row.items[i + 1];
      if (/^[ANP](?:M|OON)?$/i.test(next.str.trim())) {
        s = s + next.str;
      }
    }
    const matches = [...s.matchAll(new RegExp(TIME_PATTERN.source, "gi"))];
    for (const m of matches) {
      const t24 = to24h(m[1], m[2], m[3]);
      if (t24) times.push({ time: t24, x: it.x });
    }
  }
  if (times.length === 0) return { trips: [] };

  // "p" markers: an item whose stripped text is exactly "p" or "p " sitting
  // just before a time on the same row. We tag a time as having an extra
  // stop if any p-token's X is within 40 units to the left of the time's X.
  const pTokens = row.items
    .filter((it) => it.str.trim().toLowerCase() === "p")
    .map((it) => it.x);
  const hasPNear = (tx) => pTokens.some((px) => px < tx && tx - px < 40);

  // Sort times left-to-right and pair: time[0] = sayville, time[1] = pines.
  const sorted = times.slice().sort((a, b) => a.x - b.x);
  const out = [];
  if (sorted.length >= 2) {
    out.push({ direction: "sayville_to_pines", departureTime: sorted[0].time, x: sorted[0].x, extraStops: hasPNear(sorted[0].x) });
    out.push({ direction: "pines_to_sayville", departureTime: sorted[1].time, x: sorted[1].x, extraStops: hasPNear(sorted[1].x) });
  } else {
    out.push({ direction: "unknown", departureTime: sorted[0].time, x: sorted[0].x, extraStops: hasPNear(sorted[0].x) });
  }
  return { trips: out };
}

/**
 * Top-level entry point. Returns a list of trips for the active schedule
 * with extraStops/effectiveStart/effectiveEnd attributes.
 *
 * @param {Buffer} pdfBuffer - the raw PDF bytes
 * @param {object} opts
 * @param {string} opts.scheduleTitle - active schedule title (e.g. "Late Spring Schedule — 2026")
 * @param {number} [opts.year] - schedule year (defaults to year parsed from title, else current year)
 */
async function parseSayvillePinesPdf(pdfBuffer, opts) {
  const scheduleTitle = opts && opts.scheduleTitle;
  const year = (opts && opts.year)
    || extractYearFromTitle(scheduleTitle)
    || new Date().getFullYear();

  const items = await readPositionalItems(pdfBuffer);
  if (items.length === 0) {
    return { trips: [], parseNotes: "pdf_empty" };
  }

  const blocks = findActiveBlocks(items, scheduleTitle);
  if (blocks.length === 0) {
    return { trips: [], parseNotes: "pdf_no_active_blocks" };
  }

  const blockItems = itemsInBlocks(items, blocks);
  if (blockItems.length === 0) {
    return { trips: [], parseNotes: "pdf_active_empty" };
  }

  // Process each block independently (the active schedule may span multiple
  // visual columns; each one has its own day sections).
  const allTrips = [];
  for (const block of blocks) {
    const inBlock = blockItems.filter((it) => it.x >= block.xMin && it.x <= block.xMax && it.y < block.yMax);
    if (inBlock.length === 0) continue;

    const rows = rowsByY(inBlock);
    const sections = findDaySections(rows);
    const annots = findEffectiveAnnotations(inBlock);
    const annByRow = attachAnnotationsToRows(rows, annots);

    for (const row of rows) {
      const text = row.items.map((it) => it.str).join(" ");
      // Skip header rows.
      if (HAS_DAY_RE.test(text) && !/\d{1,2}\s*:\s*\d{2}/.test(text)) continue;
      // Find owning section (Y is between yStart and yEnd; PDF Y desc).
      const sec = sections.find((s) => row.y < s.yStart && row.y > s.yEnd);
      if (!sec) continue;

      const { trips: rowTrips } = extractRowTrips(row);
      if (rowTrips.length === 0) continue;

      const ann = annByRow.get(row);
      const effectiveStart = ann && ann.startMonth ? toIso(year, ann.startMonth, ann.startDay)
                          : ann && ann.onlyMonth ? toIso(year, ann.onlyMonth, ann.onlyDay)
                          : undefined;
      const effectiveEnd   = ann && ann.endMonth ? toIso(year, ann.endMonth, ann.endDay)
                          : ann && ann.onlyMonth ? toIso(year, ann.onlyMonth, ann.onlyDay)
                          : undefined;

      for (const t of rowTrips) {
        allTrips.push({
          daysOfWeek: sec.days,
          dayLabel: sec.label,
          direction: t.direction,
          departureTime: t.departureTime,
          extraStops: t.extraStops,
          effectiveStart,
          effectiveEnd,
        });
      }
    }
  }

  return { trips: allTrips, parseNotes: `pdf_positional:${allTrips.length}` };
}

function extractYearFromTitle(title) {
  if (!title) return null;
  const m = title.match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

module.exports = {
  // Backwards-compat exports used by sayvilleParseVision.js.
  TIME_PATTERN,
  to24h,
  extractTimesFromLine,
  // New positional entry point.
  parseSayvillePinesPdf,
  // Helpers (mostly for testing).
  parseMonthDay,
  expandDayRange,
  parseDaysFromHeader,
  daysToLabel,
  HAS_DAY_RE,
};
