import { useEffect, useState } from "react";

type Leg = {
  train: string;
  headsign: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
};

type Journey = {
  depart: string;
  arrive: string;
  durationMin: number;
  transferAt: string | null;
  legs: Leg[];
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
  error?: string;
};

const scheduleUrl = "/api/lirrSchedule";

function JourneyRow({ j }: { j: Journey }) {
  const transfer =
    j.transferAt != null ? (
      <span style={{ color: "#555" }}> via {j.transferAt}</span>
    ) : null;
  return (
    <tr>
      <td style={{ padding: "4px 8px", verticalAlign: "top", whiteSpace: "nowrap" }}>
        {j.depart} → {j.arrive}
      </td>
      <td style={{ padding: "4px 8px", verticalAlign: "top" }}>{j.durationMin}m</td>
      <td style={{ padding: "4px 8px", verticalAlign: "top", fontSize: "0.9em" }}>
        {j.legs.map((leg, i) => (
          <div key={i} style={{ marginBottom: i < j.legs.length - 1 ? 6 : 0 }}>
            <strong>{leg.train || "—"}</strong> {leg.headsign ? `· ${leg.headsign}` : ""}
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

  useEffect(() => {
    let cancelled = false;
    fetch(`${scheduleUrl}?days=14`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        return r.json() as Promise<ScheduleResponse>;
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
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: "52rem" }}>
      <h1 style={{ marginTop: 0 }}>gopines.gay</h1>
      <p style={{ marginBottom: "1.25rem" }}>
        NYC → Bay Shore → Fire Island Pines. Below: raw static LIRR timetable{" "}
        <strong>Penn Station ↔ Sayville</strong> (next 14 days, America/New_York).
      </p>

      {loading && <p>Loading schedule…</p>}
      {err && (
        <p style={{ color: "#a00" }}>
          Could not load schedule ({err}). Deploy <code>getLirrSchedule</code> and Hosting rewrite, or run{" "}
          <code>npm run dev</code> (proxies <code>/api</code> to production).
        </p>
      )}

      {data && (
        <>
          <p style={{ fontSize: "0.85rem", color: "#444" }}>
            Feed <code>{data.feedVersion}</code> · {data.disclaimer}
          </p>
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
