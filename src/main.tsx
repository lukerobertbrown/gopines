import * as Sentry from "@sentry/react";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Sentry DSNs are public by design (write-only ingestion endpoints) — Sentry's
// own docs say "DSNs are safe to expose publicly." Hardcoded so production
// builds don't depend on a local .env that may or may not be set at deploy
// time. The env var still wins if present, useful for pointing dev builds
// at a different Sentry project.
const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN ||
  "https://6d9a4f31f20ce68230fd25daf069fa40@o4511366033309696.ingest.us.sentry.io/4511366034751488";

Sentry.init({
  dsn: SENTRY_DSN,
  environment: import.meta.env.MODE,
  sendDefaultPii: true,
  integrations: [
    Sentry.feedbackIntegration({
      autoInject: false,
      colorScheme: "system",
      showName: false,
      showEmail: true,
      isEmailRequired: false,
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p style={{ fontFamily: "sans-serif", padding: 24 }}>Something went wrong — please reload the page.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
