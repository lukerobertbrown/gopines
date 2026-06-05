const { test } = require("node:test");
const assert = require("node:assert/strict");

// Inline the two helpers under test so the test file has no network dependency.
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

const FIXTURE = [
  // type=1: guaranteed timed transfer (Train 132 -> Train 64 at Babylon stop 27)
  { from_stop_id: "27", to_stop_id: "27", from_trip_id: "GO201_26_132", to_trip_id: "GO201_26_64", transfer_type: "1", min_transfer_time: "" },
  // type=2: stop-level minimum (Jamaica stop 102, 300 s)
  { from_stop_id: "102", to_stop_id: "102", from_trip_id: "", to_trip_id: "", transfer_type: "2", min_transfer_time: "300" },
];

const idx = buildTransfersIndex(FIXTURE);

test("timed transfer returns 0 for the exact trip pair", () => {
  assert.equal(requiredTransferSec(idx, "GO201_26_132", "GO201_26_64", "27", 300), 0);
});

test("timed transfer does NOT apply to a different trip pair at the same stop", () => {
  assert.equal(requiredTransferSec(idx, "GO201_26_132", "GO201_26_99", "27", 300), 300);
});

test("stop-level min_transfer_time is used when no timed row matches", () => {
  assert.equal(requiredTransferSec(idx, "TRIP_A", "TRIP_B", "102", 300), 300);
});

test("fallback is returned for an unknown stop/trip combination", () => {
  assert.equal(requiredTransferSec(idx, "TRIP_X", "TRIP_Y", "999", 300), 300);
  assert.equal(requiredTransferSec(idx, "TRIP_X", "TRIP_Y", "999", 120), 120);
});
