# gopines.gay

[Live: gopines.gay](https://gopines.gay) — a mobile-first planner for getting between Penn Station and Fire Island Pines via the LIRR + Sayville Ferry. Pick a date, pick a direction, see paired train + ferry options ranked by trip quality.

---

## Stack

- **Frontend** — Vite + React 19 + TypeScript. Single-page app, no router. Hand-drawn aesthetic via inline SVG with a wobble filter.
- **Backend** — Firebase Cloud Functions (Node 22, 2nd gen). Two codebases:
  - `lirr` — LIRR static GTFS + GTFS-Realtime
  - `ferry` — Sayville Ferry schedule ingestion (Vision OCR on the website's PNG + positional PDF parsing for ▲ markers and STARTS/ENDS annotations)
- **Persistence** — Firestore. The ferry schedule is cached in `ferry_cache/pines_schedule`.
- **Hosting** — Firebase Hosting; functions are exposed under `/api/*` rewrites.
- **Analytics** — GA4 (`G-FQYXNV8WF6`) loaded in `index.html`. Custom events: `share_trip`, `add_to_calendar`.

## Repo layout

```
.
├── src/                              # React frontend
│   ├── App.tsx                       # Almost everything UI lives here
│   ├── main.tsx                      # React entry
│   └── app.css                       # Reset + keyframes
├── functions/
│   ├── getLIRRDepartures/            # LIRR codebase: static GTFS + realtime
│   │   ├── index.js                  # 4 HTTP functions: getLirrSchedule(Live), getLirrRealtime, etc.
│   │   ├── pennSayvilleSchedule.js   # GTFS → Penn↔Sayville journeys
│   │   └── lirrGtfsRt.js             # GTFS-Realtime decode + delay merge
│   └── getFerrySchedule/             # Ferry codebase
│       ├── index.js                  # Scheduled ingest, force-ingest endpoint, getFerrySchedule
│       ├── sayvilleDiscover.js       # Scrape sayvilleferry.com for the PNG/PDF asset URLs
│       ├── sayvilleParseVision.js    # Day-aware OCR parser (geometry-based)
│       └── sayvilleParsePdf.js       # Positional PDF parser for ▲ markers + STARTS/ENDS dates
├── index.html                        # Google Fonts + GA tag + animation keyframes
├── firebase.json                     # Hosting rewrites + 2 function codebases
├── .firebaserc                       # Project ID: gopines
└── SETUP.md                          # First-time auth (gcloud, firebase login, etc.)
```

## Quickstart

First-time auth (gcloud + Firebase login) is in [SETUP.md](./SETUP.md). After that:

```bash
npm install
npm install --prefix functions/getLIRRDepartures
npm install --prefix functions/getFerrySchedule

npm run dev          # → http://localhost:5173
npm run build        # type-check + production bundle
npm run deploy       # build + firebase deploy (hosting + functions)
```

The dev server proxies `/api/*` to the live `gopines.web.app` functions, so you don't need the emulator running for normal frontend work.

## How a trip gets built

1. On load, the frontend fetches `/api/lirrScheduleLive?days=14` (LIRR + realtime delays for the next 14 days) and `/api/ferrySchedule` (the cached ferry timetable from Firestore).
2. For the selected date and direction, `buildToPines` / `buildToPenn` in `src/App.tsx` pair LIRR journeys with ferry departures using a 10-minute walk buffer at Sayville Station.
3. Each candidate trip is filtered:
   - Hard cap: total trip time `≤ 240 min` (4h)
   - Hard cap: Sayville layover `≤ 120 min` (2h)
   - Day-of-week: ferries run on the right weekday for the selected date (`daysOfWeek` from the parser)
   - Effective dates: `effectiveStart` / `effectiveEnd` from the PDF's STARTS/ENDS annotations are honored
4. Surviving trips are classified:
   - **best** (green) — total `< 3h` AND Sayville layover `≥ 20 min`
   - **risky** (amber) — total `< 3h` AND Sayville layover `< 20 min` (rushed transfer)
   - **long** (red) — total `≥ 3h`

   Tunable in `src/App.tsx` via `AVOID_TOTAL_MIN`, `COMFORT_LAYOVER_MIN`, `MAX_LAYOVER_MIN`.

## Ferry schedule ingestion

A scheduled function (`ingestSayvilleFerryPines`) runs daily at 6:00 ET and refreshes the cache.

The parser does two passes:

1. **Vision OCR** on the schedule PNG — clusters words into rows, splits the page into per-day-of-week sections, builds a per-day grid of departure times. Source of truth for *trip existence*.
2. **Positional PDF parse** on the schedule PDF — uses `pdf-parse`'s `pagerender` hook to read each text item's `(x, y)` coordinates. Source of truth for `▲` (Cherry Grove stop indicator, rendered as `p` after font substitution) and `STARTS X` / `ENDS X` / `X ONLY` date annotations.

The two passes are joined on `(dayLabel, direction, HH:MM)`. The PDF augments each Vision trip's `extraStops`, `effectiveStart`, `effectiveEnd`. The PDF carries multiple seasonal schedules (Early Spring, Spring, Late Spring, …); the parser scopes to the active one by matching the schedule's title.

### Forcing a fresh ingest

Either wait for the 6 a.m. cron, or hit the on-demand endpoint:

```bash
curl -X POST https://gopines.gay/api/forceIngestSayvilleFerryPines
```

Returns `{ ok: true, count, parseNotes }`. `parseNotes` looks like `geometry_day_aware+pdf:pdf_positional:78|augmented=78` on a healthy run. `CURRENT_INGEST_VERSION` in `functions/getFerrySchedule/index.js` is bumped whenever parser logic changes meaningfully — the scheduled job re-ingests when the on-disk version doesn't match.

## Hosting rewrites

Defined in `firebase.json`:

| Path | Function | Notes |
|---|---|---|
| `/api/lirrSchedule` | `getLirrSchedule` | Static GTFS only |
| `/api/lirrScheduleLive` | `getLirrScheduleLive` | Static + GTFS-Realtime delays for today |
| `/api/lirrRealtime` | `getLirrRealtime` | Raw GTFS-RT summary (debug) |
| `/api/ferrySchedule` | `getFerrySchedule` | Returns the cached ferry doc + optional `nextFerriesFromSayville` if `?trainArrival=<unix>` |
| `/api/forceIngestSayvilleFerryPines` | `forceIngestSayvilleFerryPines` | Re-runs the daily ingest on demand |

Everything else SPA-falls back to `/index.html`.

## Analytics

The Google tag is loaded once in `index.html`. Two custom events fire from the frontend:

- **`share_trip`** — fires on a successful share (native share sheet, clipboard copy, or `sms:` fallback). Surfaces: `'card'` (an itinerary card) or `'hero'` (the next-departure hero card).
- **`add_to_calendar`** — fires after the per-card `.ics` download is handed off. `'card'` only.

Both events ride this payload:

```ts
{
  direction: 'to-pines' | 'to-penn',
  trip_date: 'YYYY-MM-DD',
  depart_time: 'HH:MM',
  total_min: number,
  stoplight: 'green' | 'amber' | 'red',
  surface: 'card' | 'hero',
}
```

To slice by `direction` / `surface` / etc. in standard reports, register them as custom dimensions in **GA Admin → Data display → Custom definitions**. Until then they're attached to events but only visible in Realtime.

## Deployment notes

- `npm run deploy` rebuilds the frontend and deploys hosting + both function codebases. Unchanged functions are skipped automatically.
- Firestore rules deny all client reads/writes — frontend talks to functions, functions use Admin SDK.
- The ferry parser bumps `CURRENT_INGEST_VERSION` whenever its logic changes; the next scheduled run picks up the new parser even if the underlying PNG/PDF URLs haven't changed.

## Tweaks worth knowing

| What | Where | Default |
|---|---|---|
| Total-trip-time hard cap | `buildToPines`/`buildToPenn` in `src/App.tsx` | 240 min |
| Sayville layover hard cap | `MAX_LAYOVER_MIN` | 120 min |
| Ferry crossing time | `FERRY_MIN` | 30 min |
| Walk from Sayville Station to ferry dock | `WALK_MIN` (frontend) / `WALK_FROM_STATION_SEC` (functions) | 10 min / 600 s |
| Stoplight thresholds | `AVOID_TOTAL_MIN`, `COMFORT_LAYOVER_MIN` | 180 min, 20 min |
| GA tag ID | `index.html` | `G-FQYXNV8WF6` |

## Limitations

- LIRR static GTFS only refreshes on redeploy. The MTA changes infrequently but a major timetable change requires bumping the LIRR function.
- Realtime delays merge for *today only*; future-dated plans use scheduled times.
- Ferry OCR is calibrated to the current Sayville Ferry website layout. A redesign on their end may need parser tweaks.
- Adblockers strip the GA tag; analytics counts will be lower than reality.
