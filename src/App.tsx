import { useEffect, useState } from "react";

type Leg = {
  tripId?: string;
  fromStopId?: string;
  toStopId?: string;
  train: string;
  headsign: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
  delaySec?: number;
  delayMin?: number;
};

type Journey = {
  depart: string;
  arrive: string;
  durationMin: number;
  transferAt: string | null;
  legs: Leg[];
  maxDelayMin?: number;
};

type DayBlock = {
  date: string;
  weekday: string;
  outbound: Journey[];
  inbound: Journey[];
  truncated?: boolean;
  note?: string;
};

type ScheduleResponse = {
  timezone: string;
  source: string;
  feedVersion: string;
  disclaimer: string;
  stops: { penn: { name: string }; sayville: { name: string } };
  days: DayBlock[];
  realtime?: {
    source: string;
    mergedForDate: string;
    feedHeaderTimestamp: number | null;
    note: string;
  };
  error?: string;
};

const scheduleStaticUrl = "/api/lirrSchedule";
const scheduleLiveUrl = "/api/lirrScheduleLive";

function JourneyRow({ j }: { j: Journey }) {
  const transfer =
    j.transferAt != null ? (
      <span style={{ color: "#555" }}> via {j.transferAt}</span>
    ) : null;
  const tripDelay =
    j.maxDelayMin != null && j.maxDelayMin > 0 ? (
      <span style={{ color: "#b45309", fontSize: "0.85em" }}> · up to +{j.maxDelayMin}m RT</span>
    ) : null;
  return (
    <tr>
      <td style={{ padding: "4px 8px", verticalAlign: "top", whiteSpace: "nowrap" }}>
        {j.depart} → {j.arrive}
        {tripDelay}
      </td>
      <td style={{ padding: "4px 8px", verticalAlign: "top" }}>{j.durationMin}m</td>
      <td style={{ padding: "4px 8px", verticalAlign: "top", fontSize: "0.9em" }}>
        {j.legs.map((leg, i) => (
          <div key={i} style={{ marginBottom: i < j.legs.length - 1 ? 6 : 0 }}>
            <strong>{leg.train || "—"}</strong> {leg.headsign ? `· ${leg.headsign}` : ""}
            {leg.delayMin != null && leg.delayMin > 0 ? (
              <span style={{ color: "#b45309" }}> +{leg.delayMin}m</span>
            ) : null}
            <br />
            <span style={{ color: "#444" }}>
              {leg.from} {leg.dep.slice(0, 5)} → {leg.to} {leg.arr.slice(0, 5)}
            </span>
          </div>
        ))}
        {transfer}
      </td>
    </tr>
  );
}

export function App() {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [useLiveMta, setUseLiveMta] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const q = new URLSearchParams({ days: "14" });
    const url = useLiveMta ? scheduleLiveUrl : scheduleStaticUrl;
    fetch(`${url}?${q}`)
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) throw new Error(`${r.status} ${text}`);
        return JSON.parse(text) as ScheduleResponse;
      })
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [useLiveMta]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: "52rem" }}>
      <h1 style={{ marginTop: 0 }}>gopines.gay</h1>
      <p style={{ marginBottom: "0.75rem" }}>
        NYC → Bay Shore → Fire Island Pines. Raw LIRR timetable <strong>Penn Station ↔ Sayville</strong> (14 days,
        America/New_York).
      </p>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: "1rem", cursor: "pointer" }}>
        <input type="checkbox" checked={useLiveMta} onChange={(e) => setUseLiveMta(e.target.checked)} />
        <span>
          Merge live MTA feed (GTFS-Realtime) for <strong>today</strong> — needs <code>MTA_API_KEY</code> secret on
          Functions
        </span>
      </label>

      {loading && <p>Loading schedule…</p>}
      {err && (
        <p style={{ color: "#a00" }}>
          Could not load schedule ({err}). For live mode, set the secret:{" "}
          <code>firebase functions:secrets:set MTA_API_KEY</code> then redeploy. Static mode works without it.
        </p>
      )}

      {data && (
        <>
          <p style={{ fontSize: "0.85rem", color: "#444" }}>
            Feed <code>{data.feedVersion}</code> · {data.disclaimer}
          </p>
          {data.realtime && (
            <p style={{ fontSize: "0.85rem", color: "#166534", background: "#f0fdf4", padding: "0.5rem 0.75rem" }}>
              Live: {data.realtime.source}
              {data.realtime.feedHeaderTimestamp != null
                ? ` · feed ts ${data.realtime.feedHeaderTimestamp}`
                : ""}{" "}
              · merged for {data.realtime.mergedForDate}. {data.realtime.note}
            </p>
          )}
          {data.days.map((d) => (
            <section key={d.date} style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
                {d.weekday} {d.date}
                {d.truncated ? " · (list capped)" : ""}
              </h2>
              {d.note && <p style={{ fontSize: "0.9rem", color: "#666" }}>{d.note}</p>}
              <h3 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.25rem" }}>To Sayville (from Penn)</h3>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.88rem",
                  marginBottom: "0.75rem",
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                    <th style={{ padding: "4px 8px" }}>Penn → Sayville</th>
                    <th style={{ padding: "4px 8px" }}>Ride</th>
                    <th style={{ padding: "4px 8px" }}>Trains</th>
                  </tr>
                </thead>
                <tbody>
                  {d.outbound.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ padding: 8, color: "#666" }}>
                        No trips (check GTFS calendar coverage).
                      </td>
                    </tr>
                  ) : (
                    d.outbound.map((j, i) => <JourneyRow key={i} j={j} />)
                  )}
                </tbody>
              </table>
              <h3 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.25rem" }}>To Penn (from Sayville)</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                    <th style={{ padding: "4px 8px" }}>Sayville → Penn</th>
                    <th style={{ padding: "4px 8px" }}>Ride</th>
                    <th style={{ padding: "4px 8px" }}>Trains</th>
                  </tr>
                </thead>
                <tbody>
                  {d.inbound.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ padding: 8, color: "#666" }}>
                        No trips (check GTFS calendar coverage).
                      </td>
                    </tr>
                  ) : (
                    d.inbound.map((j, i) => <JourneyRow key={i} j={j} />)
                  )}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
