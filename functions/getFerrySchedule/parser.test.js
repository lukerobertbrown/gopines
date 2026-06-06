const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseVisionDocumentResult } = require("./sayvilleParseVision");
const { to24h, parseDaysFromHeader, daysToLabel } = require("./sayvilleParsePdf");
const { reconcileTrips } = require("./mergeTrips");

// ── Synthetic Vision fixture ────────────────────────────────────────────────
// Build a minimal Vision `fullTextAnnotation` for the Saturday & Sunday block:
// a day header plus 12 rows, each with a "Leave Sayville" time (left sub-column)
// and a "Leave Pines" time (right sub-column). Both sub-columns sit in the left
// page-half (cx < midX) so geometryParse pairs time[0]=sayville_to_pines and
// time[1]=pines_to_sayville per row — the real layout of one day-block.
function word(text, cx, cy) {
  return {
    text,
    boundingBox: {
      vertices: [
        { x: cx - 12, y: cy - 6 },
        { x: cx + 12, y: cy - 6 },
        { x: cx + 12, y: cy + 6 },
        { x: cx - 12, y: cy + 6 },
      ],
    },
  };
}

// [sayville-col time, pines-col time] for the 12 weekend rows.
const ROWS = [
  ["8:00A", "8:25A"],
  ["9:30A", "9:55A"],
  ["10:30A", "10:55A"],
  ["11:30A", "11:55A"],
  ["12:30P", "12:55P"],
  ["1:30P", "1:55P"],
  ["3:30P", "4:00P"],
  ["4:30P", "5:00P"],
  ["5:30P", "6:00P"],
  ["6:30P", "7:00P"],
  ["7:30P", "8:00P"],
  ["8:30P", "9:00P"],
];

function buildWeekendAnnotation() {
  const words = [];
  // Day header at the top (no digits → recognized as a section header).
  words.push(word("SATURDAY", 120, 20));
  words.push(word("&", 200, 20));
  words.push(word("SUNDAY", 270, 20));
  // Time rows, spaced well apart in Y (clusterLines yTol is 14).
  let cy = 80;
  for (const [left, right] of ROWS) {
    words.push(word(left, 120, cy));
    words.push(word(right, 320, cy));
    cy += 40;
  }
  return {
    fullTextAnnotation: {
      text: words.map((w) => w.text).join(" "),
      pages: [
        {
          width: 1000, // midX = 500 → both columns land in the left half
          height: 700,
          blocks: [{ paragraphs: [{ words }] }],
        },
      ],
    },
  };
}

const EXPECTED_PINES = ["08:25", "09:55", "10:55", "11:55", "12:55", "13:55", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
const EXPECTED_SAYVILLE = ["08:00", "09:30", "10:30", "11:30", "12:30", "13:30", "15:30", "16:30", "17:30", "18:30", "19:30", "20:30"];

test("Vision parse keeps every weekend boat, incl. 12:55pm and evening", () => {
  const { trips } = parseVisionDocumentResult(buildWeekendAnnotation());

  const pines = trips
    .filter((t) => t.direction === "pines_to_sayville")
    .map((t) => t.departureTime)
    .sort();
  const sayville = trips
    .filter((t) => t.direction === "sayville_to_pines")
    .map((t) => t.departureTime)
    .sort();

  assert.deepEqual(pines, [...EXPECTED_PINES].sort(), "all Pines→Sayville departures present");
  assert.deepEqual(sayville, [...EXPECTED_SAYVILLE].sort(), "all Sayville→Pines departures present");

  // The regression that prompted this: the 12:55pm boat and the evening boats
  // must not be dropped.
  for (const t of ["12:55", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"]) {
    assert.ok(pines.includes(t), `12:55/evening boat ${t} present`);
  }

  // Every weekend trip is tagged Sat (6) & Sun (0).
  for (const t of trips) {
    assert.deepEqual(t.daysOfWeek, [0, 6], "weekend trips tagged Sun & Sat");
  }
});

// ── Reconcile (PDF recovers a boat Vision dropped) ──────────────────────────
test("reconcileTrips recovers a boat Vision missed", () => {
  // Vision dropped the 12:55pm Pines→Sayville boat.
  const vision = [
    { dayLabel: "Saturday & Sunday", direction: "pines_to_sayville", departureTime: "11:55", daysOfWeek: [0, 6] },
    { dayLabel: "Saturday & Sunday", direction: "pines_to_sayville", departureTime: "13:55", daysOfWeek: [0, 6] },
  ];
  const pdf = [
    { dayLabel: "Saturday & Sunday", direction: "pines_to_sayville", departureTime: "11:55", daysOfWeek: [0, 6], extraStops: true },
    { dayLabel: "Saturday & Sunday", direction: "pines_to_sayville", departureTime: "12:55", daysOfWeek: [0, 6], extraStops: false },
    { dayLabel: "Saturday & Sunday", direction: "pines_to_sayville", departureTime: "13:55", daysOfWeek: [0, 6], extraStops: false },
  ];

  const { trips, augmented, added } = reconcileTrips(vision, pdf);
  const times = trips.filter((t) => t.direction === "pines_to_sayville").map((t) => t.departureTime).sort();

  assert.deepEqual(times, ["11:55", "12:55", "13:55"], "12:55 recovered from PDF");
  assert.equal(added, 1, "exactly one boat recovered");
  assert.equal(augmented, 2, "matching boats augmented");
  // The 11:55 match picks up the PDF's extraStops flag.
  assert.equal(trips.find((t) => t.departureTime === "11:55").extraStops, true);
  // The recovered boat carries day-of-week so it isn't filtered to every day.
  assert.deepEqual(trips.find((t) => t.departureTime === "12:55").daysOfWeek, [0, 6]);
});

test("reconcileTrips leaves an already-complete Vision set untouched in count", () => {
  const vision = [
    { dayLabel: "Friday", direction: "pines_to_sayville", departureTime: "12:55", daysOfWeek: [5] },
  ];
  const pdf = [
    { dayLabel: "Friday", direction: "pines_to_sayville", departureTime: "12:55", daysOfWeek: [5] },
  ];
  const { trips, added } = reconcileTrips(vision, pdf);
  assert.equal(trips.length, 1);
  assert.equal(added, 0);
});

// ── Pure helpers ────────────────────────────────────────────────────────────
test("to24h handles noon-hour PM times", () => {
  assert.equal(to24h("12", "55", "P"), "12:55");
  assert.equal(to24h("12", "30", "P"), "12:30");
  assert.equal(to24h("4", "00", "P"), "16:00");
  assert.equal(to24h("12", "00", "A"), "00:00");
  assert.equal(to24h("8", "25", "A"), "08:25");
});

test("parseDaysFromHeader / daysToLabel handle the weekend union", () => {
  assert.deepEqual(parseDaysFromHeader("SATURDAY & SUNDAY"), [0, 6]);
  assert.equal(daysToLabel([0, 6]), "Sunday & Saturday");
  assert.deepEqual(parseDaysFromHeader("MONDAY - WEDNESDAY"), [1, 2, 3]);
});
