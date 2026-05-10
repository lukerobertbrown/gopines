# Connecting GitHub, Google Cloud, and this repo

Use this folder as the single workspace in Cursor. These steps link Git, Firebase, and optionally CI.

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- **Firebase CLI:** installed locally in this repo (`firebase-tools`). Use `npm run firebase -- <args>` so you never depend on a global `firebase` on your `PATH`. (Optional: `npm install -g firebase-tools` if you want `firebase` everywhere.)
- [GitHub CLI](https://cli.github.com/) (optional): `brew install gh`

## 1. Firebase and GCP on your machine

```bash
gcloud auth login
npm install
npm run firebase -- login
gcloud auth application-default login
```

Point tools at **your** project (replace `gopines` if your Firebase/GCP **project ID** differs):

```bash
gcloud config set project gopines
npm run firebase -- use gopines
```

If `firebase use` fails, run `npm run firebase -- projects:list` and use the exact **Project ID** from that list. Update `.firebaserc` so `"default"` matches.

## 2. Git + GitHub

```bash
cd /Users/luke/gopines
git init
git add .
git commit -m "Initial scaffold: Vite React, Firebase Hosting, Cloud Functions"
```

Create an empty repo on GitHub (no README), then:

```bash
git remote add origin git@github.com:YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

Or with HTTPS: `git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git`

## 3. Install dependencies and verify build

```bash
npm install
npm run build
```

Install each function package (required before `firebase deploy`):

```bash
npm install --prefix functions/getLIRRDepartures
npm install --prefix functions/getFerrySchedule
```

## 4. Deploy

Builds the Vite app, then deploys Hosting + Functions + Firestore rules:

```bash
npm run deploy
```

Deploy only Hosting or only Functions if you prefer:

```bash
npm run firebase -- deploy --only hosting
npm run firebase -- deploy --only functions
```

## 5. Optional: GitHub Actions

Add a workflow later that runs `npm ci`, `npm run build`, and deploys using **Workload Identity Federation** or Firebase’s CI token pattern—avoid committing service account JSON keys.

## Secrets

If you add other MTA APIs that require auth, store keys in **Secret Manager** and grant the Functions runtime service account **Secret Accessor**. Do not commit API keys; keep `.env` local and listed in `.gitignore`. The LIRR GTFS-Realtime URL used here does not need a key today.

**Static LIRR timetables** (`getLirrSchedule`, `/api/lirrSchedule`) use the public GTFS zip on AWS (`gtfslirr.zip`) and do **not** need the MTA API key.

**Live GTFS-Realtime** (`getLirrScheduleLive` → `/api/lirrScheduleLive`, `getLirrRealtime` → `/api/lirrRealtime`) uses the same URL as in a browser: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr`. As of early 2026 it returns **HTTP 200 without** `x-api-key`; the app fetches it **without** a key. MTA may still ask developers to register at [api.mta.info](https://api.mta.info) and could turn on auth later — if so, wire an optional `x-api-key` again (the helper in `lirrGtfsRt.js` already supports passing a key if you add Secret Manager or env config back).

## Sayville Ferry (Vision + daily ingest)

1. In [Google Cloud Console](https://console.cloud.google.com) for project **gopines**, enable **Cloud Vision API**.
2. Grant the default Functions runtime service account **`Cloud Vision AI User`** (`roles/cloudvision.user`). It looks like `PROJECT_NUMBER-compute@developer.gserviceaccount.com`. The first successful `firebase deploy` for the ferry codebase often prompts to enable APIs; if Vision calls fail with permission errors, add this role.
3. Deploy functions. The scheduled function **`ingestSayvilleFerryPines`** runs daily at **06:00 America/New_York**: loads [Sayville Fire Island Pines](https://www.sayvilleferry.com/fire-island-pines), parses embedded Wix JSON for the PNG URL, runs **document text detection** on that PNG, writes **`ferry_cache/pines_schedule`** in Firestore.
4. Until the first run completes, **`GET /api/ferrySchedule`** returns **503**. To run the job immediately: **Google Cloud Console → Cloud Scheduler** → find the job for `ingestSayvilleFerryPines` → **Force run** (or wait for 6am).
5. **Query param** `trainArrival` (Unix seconds): response includes **`nextFerriesFromSayville`** — up to 2 departures **Sayville → Pines** after `trainArrival + 10 minutes` (same-day, `America/New_York`).
6. **Calibration:** If times or columns are wrong after a schedule image redesign, adjust heuristics in `functions/getFerrySchedule/sayvilleParseVision.js` (left/right column = dock direction) and bump **`parseVersion`** in `index.js` when you change logic.
