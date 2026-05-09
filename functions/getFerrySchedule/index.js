const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

setGlobalOptions({
  region: "us-east1",
  memory: "256MiB",
  timeoutSeconds: 10,
});

exports.getFerrySchedule = onRequest(
  {
    cors: [/gopines\.gay$/, "http://localhost:5173", "http://127.0.0.1:5173"],
    invoker: "public",
  },
  (req, res) => {
    res.status(200).json({ ok: true, message: "placeholder" });
  },
);
