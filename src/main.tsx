import * as Sentry from "@sentry/react";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
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
