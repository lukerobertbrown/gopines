/**
 * Reconcile the two ferry parses into a single trip list.
 *
 * The Vision OCR parse (sayvilleParseVision.js) and the positional PDF parse
 * (sayvilleParsePdf.js) each extract the full set of trips independently. They
 * fail in different ways: OCR occasionally drops a whole row (so a boat
 * vanishes), while the PDF parse can mis-cluster columns. Treating either one
 * as the *sole* source of trip existence means a single parser's miss silently
 * removes a real departure (e.g. the 12:55pm weekend boat).
 *
 * `reconcileTrips` keeps a boat that EITHER parser found:
 *   - For trips both parsers agree on (same dayLabel|direction|HH:MM), the PDF
 *     augments the Vision trip's extraStops / effectiveStart / effectiveEnd
 *     (the PDF preserves real glyphs, so it has reliable ▲ markers and
 *     STARTS/ENDS/ONLY date annotations that OCR drops).
 *   - PDF trips with no Vision match are appended, so an OCR row-drop no longer
 *     hides a real departure. This is safe because parseSayvillePinesPdf is
 *     already scoped to the active scheduleTitle.
 */

/** Stable identity for a trip across the two parses. */
function tripKey(t) {
  // departureTime is "HH:MM" in both parsers; slice defensively in case a
  // parser ever emits "HH:MM:SS".
  return `${t.dayLabel}|${t.direction}|${String(t.departureTime).slice(0, 5)}`;
}

/**
 * @param {object[]} visionTrips - trips from parseVisionDocumentResult (source of truth for the common case)
 * @param {object[]} pdfTrips    - trips from parseSayvillePinesPdf (attribute source + recovery set)
 * @returns {{ trips: object[], augmented: number, added: number }}
 */
function reconcileTrips(visionTrips, pdfTrips) {
  const trips = Array.isArray(visionTrips) ? visionTrips.slice() : [];
  const pdf = Array.isArray(pdfTrips) ? pdfTrips : [];

  // Index the (mutable) Vision trips by key so we can both augment matches and
  // detect which PDF trips are missing.
  const byKey = new Map();
  for (const t of trips) byKey.set(tripKey(t), t);

  let augmented = 0;
  let added = 0;
  for (const p of pdf) {
    const key = tripKey(p);
    const match = byKey.get(key);
    if (match) {
      if (typeof p.extraStops === "boolean") match.extraStops = p.extraStops;
      if (p.effectiveStart) match.effectiveStart = p.effectiveStart;
      if (p.effectiveEnd) match.effectiveEnd = p.effectiveEnd;
      augmented++;
      continue;
    }
    // PDF found a boat Vision missed — recover it.
    const recovered = {
      daysOfWeek: p.daysOfWeek ?? null,
      dayLabel: p.dayLabel ?? null,
      direction: p.direction,
      departureTime: String(p.departureTime).slice(0, 5),
      sourceColumn: p.direction === "pines_to_sayville" ? "right"
        : p.direction === "sayville_to_pines" ? "left" : "unknown",
      extraStops: !!p.extraStops,
      rawLine: "pdf_recovered",
    };
    if (p.effectiveStart) recovered.effectiveStart = p.effectiveStart;
    if (p.effectiveEnd) recovered.effectiveEnd = p.effectiveEnd;
    trips.push(recovered);
    byKey.set(key, recovered);
    added++;
  }

  return { trips, augmented, added };
}

module.exports = { reconcileTrips, tripKey };
