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

Store `MTA_API_KEY` in **Secret Manager** and grant the Functions runtime service account **Secret Accessor**. Do not commit API keys; keep `.env` local and listed in `.gitignore`.

**Static LIRR timetables** (`getLirrSchedule`, `/api/lirrSchedule`) use the public GTFS zip on AWS (`gtfslirr.zip`) and do **not** need the MTA API key.

**Live GTFS-Realtime** (`getLirrScheduleLive` → `/api/lirrScheduleLive`, and `getLirrRealtime` → `/api/lirrRealtime`) call `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr` with header `x-api-key`. Store your key in Secret Manager and attach it to Functions:

```bash
# one-time (paste key at prompt)
firebase functions:secrets:set MTA_API_KEY
firebase deploy --only functions
```

Grant the default compute service account **Secret Manager Secret Accessor** on `MTA_API_KEY` if the CLI did not already.
