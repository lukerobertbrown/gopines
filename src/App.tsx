import { useState, useEffect, type CSSProperties, type ReactNode, type MouseEvent } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  sand:  '#F8F1E4',
  paper: '#FBF6EB',
  ink:   '#2A2622',
  ocean: '#3FA9D9',
  deep:  '#1F6F95',
  coral: '#FF7A5C',
  gold:  '#F5C242',
  pink:  '#F49AC2',
  red:   '#E25E4C',
  amber: '#E8B53E',
  green: '#5BAE7E',
} as const;

const F = {
  hand:   "'Patrick Hand', cursive",
  marker: "'Kalam', cursive",
  disco:  "'Monoton', sans-serif",
} as const;

// ─── API types ────────────────────────────────────────────────────────────────
type Leg = {
  train: string;
  headsign: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
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
};

type ScheduleResp = { days: DayBlock[]; error?: string };

type FerryTrip = {
  departureTime: string;
  direction: 'sayville_to_pines' | 'pines_to_sayville' | 'unknown';
};

type FerryResp = { trips: FerryTrip[]; error?: string };

// ─── UI types ─────────────────────────────────────────────────────────────────
type Stoplight = 'green' | 'amber' | 'red';

type Segment = {
  kind: 'train' | 'bus' | 'ferry';
  time: string;     // formatted, e.g. "8:08a"
  fromTo: string;   // "Penn → Babylon"
  name?: string;    // train number, e.g. "605"
};

type Itinerary = {
  id: number;
  depart: string;    // "8:08a"
  departRaw: string; // "HH:MM"
  arrive: string;
  arriveRaw: string;
  layover: number;   // minutes at Sayville
  total: number;     // total trip minutes
  stoplight: Stoplight;
  best: boolean;
  segments: Segment[];
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const FERRY_MIN       = 30;  // Sayville ↔ Pines crossing time
const WALK_MIN        = 10;  // walk from Sayville station to ferry dock
const MAX_LAYOVER_MIN = 120; // hide itineraries where the Sayville wait > 2 hours

function toMin(hhmm: string): number {
  const [h, m] = (hhmm || '').slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function addMin(hhmm: string, delta: number): string {
  const t = toMin(hhmm) + delta;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function fmt(hhmm: string): string {
  const s = (hhmm || '').slice(0, 5);
  const [hStr, mStr] = s.split(':');
  let h = parseInt(hStr, 10) % 24;
  const suffix = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return `${h}:${mStr}${suffix}`;
}

function hmStr(totalMin: number): string {
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sl(min: number): Stoplight {
  return min <= 150 ? 'green' : min <= 180 ? 'amber' : 'red';
}

function slInfo(s: Stoplight) {
  return s === 'green' ? { bg: C.green, label: 'breeze' }
       : s === 'amber' ? { bg: C.amber, label: 'doable' }
       :                 { bg: C.red,   label: 'avoid'  };
}

function todayNY(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function nowNY(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

function rollingDates(todayStr: string) {
  const base = new Date(todayStr + 'T12:00:00');
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return {
      i,
      dow: DOW[d.getDay()],
      dom: d.getDate(),
      label: d.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
      weekend: d.getDay() === 5 || d.getDay() === 6,
      today: i === 0,
      dateStr: d.toLocaleDateString('en-CA'),
    };
  });
}

// Fallback when ferry schedule hasn't been ingested yet
const MOCK_TO_PINES: FerryTrip[] = [
  '09:00','10:30','12:00','13:30','15:00','16:30','18:00','19:30',
].map(t => ({ departureTime: t, direction: 'sayville_to_pines' as const }));

const MOCK_TO_PENN: FerryTrip[] = [
  '09:30','11:00','12:30','14:00','15:30','17:00','18:30','20:00',
].map(t => ({ departureTime: t, direction: 'pines_to_sayville' as const }));

function markBest(list: Itinerary[]) {
  if (!list.length) return;
  const minT = Math.min(...list.map(x => x.total));
  let done = false;
  for (const r of list) { if (!done && r.total === minT) { r.best = true; done = true; } }
}

function buildToPines(outbound: Journey[], ferries: FerryTrip[]): Itinerary[] {
  const pines = ferries
    .filter(f => f.direction === 'sayville_to_pines' || f.direction === 'unknown')
    .map(f => f.departureTime.slice(0, 5))
    .sort();
  let id = 0;
  const result: Itinerary[] = [];
  for (const j of outbound) {
    const sayArr = j.arrive.slice(0, 5);
    const thresh = toMin(sayArr) + WALK_MIN;
    const ferry = pines.find(t => toMin(t) >= thresh);
    if (!ferry) continue;
    const layover = toMin(ferry) - toMin(sayArr);
    if (layover > MAX_LAYOVER_MIN) continue;
    const pinesArrRaw = addMin(ferry, FERRY_MIN);
    const total = toMin(pinesArrRaw) - toMin(j.depart.slice(0, 5));
    if (total < 60 || total > 240) continue;
    const segments: Segment[] = [
      ...j.legs.map(l => ({
        kind: 'train' as const,
        time: fmt(l.dep),
        fromTo: `${l.from} → ${l.to}`,
        name: l.train,
      })),
      { kind: 'bus',   time: fmt(sayArr), fromTo: 'Sayville Station → Ferry Terminal' },
      { kind: 'ferry', time: fmt(ferry),  fromTo: 'Sayville → Pines' },
    ];
    result.push({
      id: ++id,
      depart: fmt(j.depart),    departRaw: j.depart.slice(0, 5),
      arrive: fmt(pinesArrRaw), arriveRaw: pinesArrRaw,
      layover, total, stoplight: sl(total), best: false,
      segments,
    });
  }
  markBest(result);
  return result;
}

function buildToPenn(inbound: Journey[], ferries: FerryTrip[]): Itinerary[] {
  const hasPenn = ferries.some(f => f.direction === 'pines_to_sayville');
  const pennDeps = ferries
    .filter(f => hasPenn ? f.direction === 'pines_to_sayville' : f.direction === 'unknown')
    .map(f => f.departureTime.slice(0, 5))
    .sort();
  const trains = [...inbound].sort((a, b) => toMin(a.depart.slice(0, 5)) - toMin(b.depart.slice(0, 5)));
  let id = 0;
  const result: Itinerary[] = [];
  for (const ferryDep of pennDeps) {
    const sayArrRaw = addMin(ferryDep, FERRY_MIN);
    const thresh = toMin(sayArrRaw) + WALK_MIN;
    const train = trains.find(j => toMin(j.depart.slice(0, 5)) >= thresh);
    if (!train) continue;
    const layover = toMin(train.depart.slice(0, 5)) - toMin(sayArrRaw);
    if (layover > MAX_LAYOVER_MIN) continue;
    const total = toMin(train.arrive.slice(0, 5)) - toMin(ferryDep);
    if (total < 60 || total > 240) continue;
    const segments: Segment[] = [
      { kind: 'ferry', time: fmt(ferryDep),  fromTo: 'Pines → Sayville' },
      { kind: 'bus',   time: fmt(sayArrRaw), fromTo: 'Ferry Terminal → Sayville Station' },
      ...train.legs.map(l => ({
        kind: 'train' as const,
        time: fmt(l.dep),
        fromTo: `${l.from} → ${l.to}`,
        name: l.train,
      })),
    ];
    result.push({
      id: ++id,
      depart: fmt(ferryDep),      departRaw: ferryDep,
      arrive: fmt(train.arrive),  arriveRaw: train.arrive.slice(0, 5),
      layover, total, stoplight: sl(total), best: false,
      segments,
    });
  }
  markBest(result);
  return result;
}

// ─── SVG primitives ───────────────────────────────────────────────────────────
function WobbleDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id="wobble" x="-2%" y="-2%" width="104%" height="104%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="1.6" />
        </filter>
      </defs>
    </svg>
  );
}

function SketchBox({ children, color = C.ink, fill = 'transparent', radius = 14, sw = 1.6, style = {}, pad = 12 }: {
  children: ReactNode; color?: string; fill?: string; radius?: number;
  sw?: number; style?: CSSProperties; pad?: number;
}) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', filter: 'url(#wobble)' }}
        preserveAspectRatio="none"
      >
        <rect
          x={sw / 2 + 1} y={sw / 2 + 1}
          width={`calc(100% - ${sw + 2}px)`} height={`calc(100% - ${sw + 2}px)`}
          rx={radius} ry={radius} fill={fill} stroke={color} strokeWidth={sw}
          strokeLinejoin="round" strokeLinecap="round"
        />
      </svg>
      <div style={{ position: 'relative', padding: pad }}>{children}</div>
    </div>
  );
}

function Seagull({ size = 18, color = C.ink, style = {} }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 40 20" style={style}>
      <path d="M2 14 Q 10 2, 18 12 Q 22 6, 26 12 Q 32 2, 38 14"
        stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#wobble)" />
    </svg>
  );
}

function Sparkle({ size = 14, style = {} }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={style}>
      <path d="M10 1 L11.5 8.5 L19 10 L11.5 11.5 L10 19 L8.5 11.5 L1 10 L8.5 8.5 Z"
        fill={C.gold} stroke={C.ink} strokeWidth="0.8" strokeLinejoin="round" filter="url(#wobble)" />
    </svg>
  );
}

function Sun({ size = 60, style = {} }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={style}>
      <g filter="url(#wobble)">
        <circle cx="50" cy="50" r="20" fill={C.gold} stroke={C.ink} strokeWidth="2" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <line key={i}
              x1={50 + Math.cos(a) * 28} y1={50 + Math.sin(a) * 28}
              x2={50 + Math.cos(a) * 42} y2={50 + Math.sin(a) * 42}
              stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
          );
        })}
      </g>
    </svg>
  );
}

function Wave({ width = 80, color = C.ocean, style = {} }: { width?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={width} height={12} viewBox="0 0 80 12" style={style}>
      <path d="M0 6 Q 5 1, 10 6 T 20 6 T 30 6 T 40 6 T 50 6 T 60 6 T 70 6 T 80 6"
        stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" filter="url(#wobble)" />
    </svg>
  );
}

function Train({ size = 52, puff = false, style = {} }: { size?: number; puff?: boolean; style?: CSSProperties }) {
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 100 62" style={style}>
      {puff && (
        <g filter="url(#wobble)">
          <circle cx="14" cy="14" r="6" fill="#fff" stroke={C.ink} strokeWidth="1.4" />
          <circle cx="6"  cy="20" r="4" fill="#fff" stroke={C.ink} strokeWidth="1.4" />
          <circle cx="22" cy="9"  r="4" fill="#fff" stroke={C.ink} strokeWidth="1.4" />
        </g>
      )}
      <g filter="url(#wobble)">
        <rect x="22" y="22" width="60" height="24" rx="4" fill={C.coral} stroke={C.ink} strokeWidth="1.6" />
        <path d="M82 22 L92 22 L92 46 L82 46 Z" fill={C.gold} stroke={C.ink} strokeWidth="1.6" />
        <rect x="28" y="26" width="10" height="10" rx="1.5" fill={C.paper} stroke={C.ink} strokeWidth="1.2" />
        <rect x="42" y="26" width="10" height="10" rx="1.5" fill={C.paper} stroke={C.ink} strokeWidth="1.2" />
        <rect x="56" y="26" width="10" height="10" rx="1.5" fill={C.paper} stroke={C.ink} strokeWidth="1.2" />
        <line x1="22" y1="40" x2="82" y2="40" stroke={C.ink} strokeWidth="1.2" />
        <circle cx="34" cy="50" r="6" fill={C.ink} /><circle cx="34" cy="50" r="2" fill={C.paper} />
        <circle cx="56" cy="50" r="6" fill={C.ink} /><circle cx="56" cy="50" r="2" fill={C.paper} />
        <circle cx="78" cy="50" r="6" fill={C.ink} /><circle cx="78" cy="50" r="2" fill={C.paper} />
        <line x1="0" y1="58" x2="100" y2="58" stroke={C.ink} strokeWidth="1.2" strokeDasharray="3 3" />
      </g>
    </svg>
  );
}

function Ferry({ size = 60, wakes = false, style = {} }: { size?: number; wakes?: boolean; style?: CSSProperties }) {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 100 70" style={style}>
      <g filter="url(#wobble)">
        <path d="M8 44 L92 44 L84 58 L16 58 Z" fill={C.ocean} stroke={C.ink} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="22" y="28" width="56" height="16" fill={C.paper} stroke={C.ink} strokeWidth="1.6" />
        <rect x="28" y="32" width="8" height="8" fill={C.ocean} stroke={C.ink} strokeWidth="1" />
        <rect x="40" y="32" width="8" height="8" fill={C.ocean} stroke={C.ink} strokeWidth="1" />
        <rect x="52" y="32" width="8" height="8" fill={C.ocean} stroke={C.ink} strokeWidth="1" />
        <rect x="64" y="32" width="8" height="8" fill={C.ocean} stroke={C.ink} strokeWidth="1" />
        <rect x="42" y="14" width="22" height="14" fill={C.coral} stroke={C.ink} strokeWidth="1.6" />
        <line x1="54" y1="14" x2="54" y2="4" stroke={C.ink} strokeWidth="1.4" />
        <path d="M54 4 L62 7 L54 10 Z" fill={C.pink} stroke={C.ink} strokeWidth="1.2" />
        <rect x="32" y="10" width="6" height="18" fill={C.gold} stroke={C.ink} strokeWidth="1.4" />
        {wakes && (
          <>
            <path d="M0 64 Q 5 60, 10 64 T 20 64 T 30 64 T 40 64 T 50 64 T 60 64 T 70 64 T 80 64 T 90 64 T 100 64"
              stroke={C.ocean} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M0 68 Q 6 65, 12 68 T 24 68 T 36 68 T 48 68 T 60 68 T 72 68 T 84 68 T 96 68"
              stroke={C.deep} strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.7" />
          </>
        )}
      </g>
    </svg>
  );
}

function Bus({ size = 44, style = {} }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 100 62" style={style}>
      <g filter="url(#wobble)">
        {/* body */}
        <rect x="8" y="18" width="80" height="28" rx="5" fill={C.mint} stroke={C.ink} strokeWidth="1.6" />
        {/* roof line */}
        <line x1="10" y1="24" x2="86" y2="24" stroke={C.ink} strokeWidth="1.2" />
        {/* windows */}
        <rect x="14" y="26" width="12" height="10" rx="1.2" fill={C.paper} stroke={C.ink} strokeWidth="1" />
        <rect x="30" y="26" width="12" height="10" rx="1.2" fill={C.paper} stroke={C.ink} strokeWidth="1" />
        <rect x="46" y="26" width="12" height="10" rx="1.2" fill={C.paper} stroke={C.ink} strokeWidth="1" />
        <rect x="62" y="26" width="12" height="10" rx="1.2" fill={C.paper} stroke={C.ink} strokeWidth="1" />
        {/* door */}
        <rect x="78" y="26" width="6" height="18" fill={C.paper} stroke={C.ink} strokeWidth="1" />
        {/* headlight */}
        <circle cx="86" cy="42" r="1.5" fill={C.gold} stroke={C.ink} strokeWidth="0.8" />
        {/* wheels */}
        <circle cx="24" cy="50" r="6" fill={C.ink} />
        <circle cx="24" cy="50" r="2" fill={C.paper} />
        <circle cx="72" cy="50" r="6" fill={C.ink} />
        <circle cx="72" cy="50" r="2" fill={C.paper} />
        {/* ground */}
        <line x1="0" y1="58" x2="100" y2="58" stroke={C.ink} strokeWidth="1.2" strokeDasharray="3 3" />
      </g>
    </svg>
  );
}

function BeachSketch({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.78} viewBox="0 0 36 28">
      <g filter="url(#wobble)">
        <circle cx="28" cy="7" r="3.2" fill={C.gold} stroke={C.ink} strokeWidth="1" />
        <path d="M9 22 Q 8 14, 11 7"  stroke={C.ink} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M11 7 Q 5 4, 2 7"    stroke={C.ink} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M11 7 Q 16 3, 20 5"  stroke={C.ink} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M11 7 Q 14 2, 17 1"  stroke={C.ink} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M11 7 Q 7 2, 6 0"    stroke={C.ink} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M0 22 Q 9 20, 18 22 T 36 22" stroke={C.ink} strokeWidth="1.2" fill={C.sand} />
        <path d="M0 25 q 3 -1.5 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0"
          stroke={C.ocean} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function SkylineSketch({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.78} viewBox="0 0 36 28">
      <g filter="url(#wobble)">
        <rect x="14" y="2" width="6" height="22" fill={C.paper} stroke={C.ink} strokeWidth="1.2" />
        <line x1="17" y1="2"  x2="17" y2="-1" stroke={C.ink} strokeWidth="1" />
        <line x1="15.5" y1="6"  x2="18.5" y2="6"  stroke={C.ink} strokeWidth="0.8" />
        <line x1="15.5" y1="10" x2="18.5" y2="10" stroke={C.ink} strokeWidth="0.8" />
        <line x1="15.5" y1="14" x2="18.5" y2="14" stroke={C.ink} strokeWidth="0.8" />
        <line x1="15.5" y1="18" x2="18.5" y2="18" stroke={C.ink} strokeWidth="0.8" />
        <rect x="2"  y="11" width="10" height="13" fill={C.paper} stroke={C.ink} strokeWidth="1.2" />
        <line x1="4"  y1="14" x2="4"  y2="22" stroke={C.ink} strokeWidth="0.7" />
        <line x1="7"  y1="14" x2="7"  y2="22" stroke={C.ink} strokeWidth="0.7" />
        <line x1="10" y1="14" x2="10" y2="22" stroke={C.ink} strokeWidth="0.7" />
        <rect x="22" y="9" width="12" height="15" fill={C.paper} stroke={C.ink} strokeWidth="1.2" />
        <rect x="25" y="5" width="4"  height="4"  fill={C.coral} stroke={C.ink} strokeWidth="1" />
        <line x1="24" y1="13" x2="32" y2="13" stroke={C.ink} strokeWidth="0.7" />
        <line x1="24" y1="17" x2="32" y2="17" stroke={C.ink} strokeWidth="0.7" />
        <line x1="24" y1="21" x2="32" y2="21" stroke={C.ink} strokeWidth="0.7" />
        <line x1="0"  y1="24" x2="36" y2="24" stroke={C.ink} strokeWidth="1.2" />
      </g>
    </svg>
  );
}

// ─── Feature components ───────────────────────────────────────────────────────
function ShareButton({ text, tone = 'light', style = {} }: {
  text: string; tone?: 'light' | 'dark'; style?: CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  const dark = tone === 'dark';
  const fg = dark ? '#fff' : C.ink;
  const bg = dark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.7)';

  const onShare = async (e: MouseEvent) => {
    e.stopPropagation();
    const payload = { title: 'gopines.gay', text, url: 'https://gopines.gay' };
    try {
      if (navigator.share) await navigator.share(payload);
      else if (navigator.clipboard) await navigator.clipboard.writeText(text);
      else window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (_) { /* cancelled */ }
  };

  return (
    <button onClick={onShare} aria-label="share trip" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      border: '1.2px solid ' + (dark ? 'rgba(255,255,255,0.55)' : C.ink),
      background: bg, color: fg, cursor: 'pointer', borderRadius: 999, padding: '3px 9px',
      fontFamily: F.marker, fontSize: 11, letterSpacing: 0.6,
      boxShadow: dark ? 'none' : '1px 1.5px 0 ' + C.ink,
      ...style,
    }}>
      <svg width="11" height="11" viewBox="0 0 14 14">
        <g stroke={fg} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#wobble)">
          <circle cx="3"  cy="7"  r="1.6" fill={fg} />
          <circle cx="11" cy="3"  r="1.6" fill={fg} />
          <circle cx="11" cy="11" r="1.6" fill={fg} />
          <line x1="4.2" y1="6.3" x2="9.8" y2="3.7" />
          <line x1="4.2" y1="7.7" x2="9.8" y2="10.3" />
        </g>
      </svg>
      {copied ? 'COPIED' : 'SHARE'}
    </button>
  );
}

function DirectionToggle({ value, onChange }: {
  value: 'to-pines' | 'to-penn'; onChange: (v: 'to-pines' | 'to-penn') => void;
}) {
  const isPines = value === 'to-pines';
  return (
    <SketchBox color={C.ink} fill={C.paper} radius={28} sw={1.6} pad={2} style={{ margin: '0 18px' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 56 }}>
        <div style={{
          position: 'absolute', top: 4, bottom: 4,
          left: isPines ? 4 : '50%',
          width: 'calc(50% - 4px)',
          background: isPines ? C.coral : C.deep,
          borderRadius: 24, transition: 'left .25s ease, background .25s ease',
          boxShadow: '2px 3px 0 ' + C.ink, border: '1.4px solid ' + C.ink,
        }} />
        <div style={{ position: 'relative', display: 'flex', width: '100%', zIndex: 1 }}>
          {(['to-pines', 'to-penn'] as const).map(k => {
            const on = value === k;
            return (
              <button key={k} onClick={() => onChange(k)} style={{
                flex: 1, border: 'none', background: 'transparent', cursor: 'pointer',
                padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
                justifyContent: 'center', fontFamily: F.marker, fontSize: 16,
                color: on ? '#fff' : '#9b958c', letterSpacing: 0.4,
                transition: 'color .2s ease',
              }}>
                <span style={{ filter: on ? 'none' : 'grayscale(0.4) opacity(0.8)', transition: 'filter .2s ease' }}>
                  {k === 'to-pines' ? <BeachSketch size={26} /> : <SkylineSketch size={26} />}
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  {k === 'to-pines' ? 'To the Pines' : 'To Penn'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SketchBox>
  );
}

function NextHero({ direction, itineraries, todayLabel }: {
  direction: 'to-pines' | 'to-penn';
  itineraries: Itinerary[];   // always today's, earliest-first
  todayLabel: string;          // formatted, e.g. "Sat May 9, 2026"
}) {
  const toPines = direction === 'to-pines';
  const nowM = toMin(nowNY());
  const next = itineraries.find(it => toMin(it.departRaw) > nowM) ?? itineraries[0];

  if (!next) {
    return (
      <div style={{ margin: '2px 18px 12px' }}>
        <SketchBox color={C.ink} fill={toPines ? C.gold : C.ocean} radius={20} sw={1.8} pad={14}>
          <div style={{ fontFamily: F.hand, color: toPines ? '#5b4a18' : '#e9f5fc', fontSize: 15 }}>
            {toPines ? 'No more trains today — check back tomorrow!' : 'No more ferries today — see you next time!'}
          </div>
        </SketchBox>
      </div>
    );
  }

  const diffMin = toMin(next.departRaw) - nowM;
  const showCountdown = diffMin > 0 && diffMin < 12 * 60;
  const title = toPines ? 'NEXT TRAIN FROM PENN' : 'NEXT FERRY OFF THE PINES';
  const firstSeg = next.segments[0];
  const lastSeg  = next.segments[next.segments.length - 1];
  const sub = `${firstSeg.fromTo} → ${lastSeg.time} ${lastSeg.kind === 'ferry' ? 'ferry' : 'train'}`;
  const shareText = buildShareText(direction, todayLabel, next.segments);

  return (
    <div style={{ margin: '2px 18px 12px', position: 'relative' }}>
      <SketchBox color={C.ink} fill={toPines ? C.gold : C.ocean} radius={20} sw={1.8} pad={0}>
        <div style={{ padding: '12px 14px', position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', right: 8, top: 14, opacity: 0.95,
            animation: toPines ? 'wf-chug 2.6s ease-in-out infinite' : 'wf-sail 4.2s ease-in-out infinite',
          }}>
            {toPines ? <Train size={56} puff /> : <Ferry size={56} wakes />}
          </div>

          <div style={{ fontFamily: F.hand, fontSize: 15, color: toPines ? '#5b4a18' : '#e9f5fc', letterSpacing: 0.3 }}>
            {title}
          </div>
          <div style={{ fontFamily: F.disco, fontSize: 34, letterSpacing: 1.5, color: C.ink, lineHeight: 1, marginTop: 2 }}>
            {next.depart.toUpperCase()}
          </div>
          {showCountdown && (
            <div style={{ fontFamily: F.marker, fontSize: 17, marginTop: 4, color: toPines ? C.ink : '#fff', letterSpacing: 0.3 }}>
              in <span style={{ fontSize: 20 }}>{hmStr(diffMin)}</span>
            </div>
          )}
          <div style={{ fontFamily: F.hand, fontSize: 14, marginTop: 4, color: toPines ? '#5b4a18' : '#e9f5fc', lineHeight: 1.25, maxWidth: '70%' }}>
            {sub}
          </div>
          <ShareButton tone={toPines ? 'light' : 'dark'} text={shareText}
            style={{ position: 'absolute', right: 10, bottom: 10 }} />
        </div>
      </SketchBox>
    </div>
  );
}

function SegmentSprite({ kind, animated }: { kind: Segment['kind']; animated: boolean }) {
  if (kind === 'train') return <Train size={40} puff={animated} />;
  if (kind === 'ferry') return <Ferry size={42} wakes={animated} />;
  return <Bus size={42} />;
}

function segmentAnimation(kind: Segment['kind'], animated: boolean): string {
  if (!animated) return 'none';
  if (kind === 'train') return 'wf-chug 2.6s ease-in-out infinite';
  if (kind === 'ferry') return 'wf-sail 4.2s ease-in-out infinite';
  return 'none';
}

function buildShareText(direction: 'to-pines' | 'to-penn', dateLabel: string, segments: Segment[]): string {
  const dirLabel = direction === 'to-pines' ? 'To the Pines' : 'To Penn';
  const bullets = segments.map(s => {
    const tail = s.name ? ` (${s.name})` : '';
    return `• ${s.time} — ${s.fromTo}${tail}`;
  }).join('\n');
  return `${dateLabel}\n${dirLabel}\n\n${bullets}\n\ngopines.gay`;
}

function ItineraryRow({ it, direction, dateLabel }: {
  it: Itinerary;
  direction: 'to-pines' | 'to-penn';
  dateLabel: string;
}) {
  const { bg, label } = slInfo(it.stoplight);
  const anim = it.best;
  const shareText = buildShareText(direction, dateLabel, it.segments);

  return (
    <SketchBox color={C.ink} fill={C.paper} radius={18} sw={1.6} pad={0}
      style={{ margin: '0 18px 10px', position: 'relative' }}>
      <div style={{ padding: '10px 14px' }}>

        {/* Header: times + stoplight + duration */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontFamily: F.marker, fontSize: 20, color: C.ink, letterSpacing: 0.4 }}>
            {it.depart}
            <span style={{ fontFamily: F.hand, fontSize: 16, margin: '0 6px', color: '#7a736a' }}>—</span>
            {it.arrive}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: bg, border: '1.2px solid ' + C.ink, display: 'inline-block' }} />
            <span style={{ fontFamily: F.marker, fontSize: 12, color: C.ink, letterSpacing: 0.4 }}>{label}</span>
            <span style={{ fontFamily: F.hand, fontSize: 13, color: '#9b958c', marginLeft: 4 }}>· {hmStr(it.total)}</span>
          </div>
        </div>

        {/* Vertical timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {it.segments.map((seg, i) => {
            const isLast = i === it.segments.length - 1;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
                {/* Sprite column */}
                <div style={{
                  width: 52,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flex: '0 0 auto',
                }}>
                  <div style={{
                    height: 30,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: segmentAnimation(seg.kind, anim),
                  }}>
                    <SegmentSprite kind={seg.kind} animated={anim} />
                  </div>
                  {!isLast && (
                    <svg width="4" height="22" style={{ display: 'block', marginTop: 1 }}>
                      <line x1="2" y1="0" x2="2" y2="22" stroke={C.ink} strokeWidth="1.2" strokeDasharray="3 3" filter="url(#wobble)" />
                    </svg>
                  )}
                </div>

                {/* Text column */}
                <div style={{ flex: 1, paddingTop: 6, paddingLeft: 4, paddingBottom: isLast ? 0 : 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: F.marker, fontSize: 16, color: C.ink, letterSpacing: 0.3 }}>{seg.time}</span>
                    <span style={{ fontFamily: F.hand, fontSize: 14, color: C.ink, lineHeight: 1.15 }}>{seg.fromTo}</span>
                  </div>
                  {seg.name && (
                    <div style={{ fontFamily: F.hand, fontSize: 12, color: '#9b958c', marginTop: 1 }}>
                      Train {seg.name}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Share */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <ShareButton text={shareText} />
        </div>

        {it.best && (
          <div style={{
            position: 'absolute', top: -10, left: 14,
            fontFamily: F.disco, fontSize: 12, letterSpacing: 1.5, color: C.ink, background: C.gold,
            padding: '2px 9px 0', borderRadius: 999, border: '1.4px solid ' + C.ink,
            boxShadow: '1.5px 2px 0 ' + C.ink, transform: 'rotate(-3deg)',
          }}>★ DISCO PICK ★</div>
        )}
      </div>
    </SketchBox>
  );
}

function DatePickerStrip({ value, onChange, dates }: {
  value: number;
  onChange: (i: number) => void;
  dates: ReturnType<typeof rollingDates>;
}) {
  return (
    <div style={{ margin: '6px 0 10px' }}>
      <div style={{ fontFamily: F.marker, fontSize: 14, letterSpacing: 0.8, color: C.ink, padding: '0 18px 6px' }}>
        WHEN ?
      </div>
      <div style={{ overflowX: 'auto', padding: '4px 18px 8px' }}>
        <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
          {dates.map(d => {
            const on = value === d.i;
            return (
              <button key={d.i} onClick={() => onChange(d.i)} style={{
                flex: '0 0 auto', width: 52, padding: '8px 0',
                border: '1.6px solid ' + C.ink, borderRadius: 999,
                background: on ? C.coral : (d.weekend ? C.paper : '#fff'),
                color: on ? '#fff' : C.ink,
                boxShadow: on ? '2px 3px 0 ' + C.ink : '1.5px 2px 0 ' + C.ink,
                cursor: 'pointer', position: 'relative',
                transform: on ? 'translate(-1px,-1px)' : 'none',
              }}>
                <div style={{ fontFamily: F.hand, fontSize: 13, opacity: 0.8 }}>{d.today ? 'today' : d.dow}</div>
                <div style={{ fontFamily: F.marker, fontSize: 18, lineHeight: 1, letterSpacing: 0.5 }}>{d.dom}</div>
                {d.weekend && !on && (
                  <span style={{ position: 'absolute', top: -6, right: -4 }}><Sparkle size={12} /></span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend({ sort, onSort }: { sort: 'earliest' | 'latest'; onSort: (s: 'earliest' | 'latest') => void }) {
  const dot = (color: string, lbl: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 9, height: 9, borderRadius: 999, background: color, border: '1.1px solid ' + C.ink, display: 'inline-block' }} />
      <span style={{ fontFamily: F.hand, fontSize: 12, color: '#5a544c' }}>{lbl}</span>
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', margin: '2px 18px 8px' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {dot(C.green, 'breeze')}{dot(C.amber, 'doable')}{dot(C.red, 'avoid')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1.2px solid ' + C.ink, borderRadius: 999, background: C.paper, padding: 2 }}>
        <span style={{ fontFamily: F.hand, fontSize: 12, color: '#9b958c', padding: '0 4px 0 8px' }}>sort</span>
        {(['earliest', 'latest'] as const).map(k => (
          <button key={k} onClick={() => onSort(k)} style={{
            border: 'none', background: sort === k ? C.ink : 'transparent',
            color: sort === k ? C.paper : '#5a544c',
            fontFamily: F.marker, fontSize: 12, letterSpacing: 0.5,
            padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
          }}>{k.charAt(0).toUpperCase() + k.slice(1)}</button>
        ))}
      </div>
    </div>
  );
}

function DiscoHeader() {
  return (
    <div style={{ padding: '6px 18px 8px', position: 'relative' }}>
      <div style={{ fontFamily: F.disco, fontSize: 28, letterSpacing: 1.5, color: C.ink, lineHeight: 1 }}>
        GOPINES.GAY
      </div>
      <div style={{ position: 'absolute', top: 0, right: 14 }}><Sun size={42} /></div>
      <div style={{ position: 'absolute', top: 14, right: 64 }}><Seagull size={18} /></div>
      <div style={{ position: 'absolute', top: 30, right: 78 }}><Seagull size={12} /></div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export function App() {
  const today = todayNY();
  const dates = rollingDates(today);

  const [dateIdx, setDateIdx]     = useState(0);
  const [direction, setDirection] = useState<'to-pines' | 'to-penn'>('to-pines');
  const [sort, setSort]           = useState<'earliest' | 'latest'>('earliest');
  const [lirrData, setLirrData]   = useState<ScheduleResp | null>(null);
  const [ferryData, setFerryData] = useState<FerryResp | null>(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);
  const [ferryMock, setFerryMock] = useState(false);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      fetch('/api/lirrScheduleLive?days=14').then(r => r.json() as Promise<ScheduleResp>),
      fetch('/api/ferrySchedule')
        .then(r => r.ok ? r.json() as Promise<FerryResp> : Promise.resolve(null))
        .catch(() => null),
    ]).then(([lirr, ferry]) => {
      setLirrData(lirr);
      if (!ferry || ferry.error || !ferry.trips?.length) {
        setFerryMock(true);
        setFerryData({ trips: [...MOCK_TO_PINES, ...MOCK_TO_PENN] });
      } else {
        setFerryMock(false);
        setFerryData(ferry);
      }
    }).catch(e => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  const selectedDay = lirrData?.days?.find(d => d.date === dates[dateIdx].dateStr);
  const ferryTrips  = ferryData?.trips ?? [];

  let itineraries: Itinerary[] = [];
  if (selectedDay && ferryTrips.length) {
    const raw = direction === 'to-pines'
      ? buildToPines(selectedDay.outbound, ferryTrips)
      : buildToPenn(selectedDay.inbound, ferryTrips);
    itineraries = sort === 'latest' ? [...raw].reverse() : raw;
  }

  // Hero card always uses today's data, earliest-first — independent of date/sort.
  const todayDay = lirrData?.days?.find(d => d.date === today);
  const todayItineraries: Itinerary[] = (todayDay && ferryTrips.length)
    ? (direction === 'to-pines'
        ? buildToPines(todayDay.outbound, ferryTrips)
        : buildToPenn(todayDay.inbound, ferryTrips))
    : [];

  const fmtDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };
  const selectedDateLabel = fmtDateLabel(dates[dateIdx].dateStr);
  const todayLabel = fmtDateLabel(today);

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(180deg, ${C.sand} 0%, ${C.paper} 38%, ${C.paper} 100%)`,
      fontFamily: F.hand,
      maxWidth: 430,
      margin: '0 auto',
      position: 'relative',
    }}>
      <WobbleDefs />

      <div style={{ position: 'absolute', top: 76, left: 8, pointerEvents: 'none' }}>
        <Seagull size={14} />
      </div>

      <DiscoHeader />

      <div style={{ marginBottom: 8 }}>
        <DirectionToggle value={direction} onChange={v => { setDirection(v); setSort('earliest'); }} />
      </div>

      {!loading && !err && (
        <NextHero direction={direction} itineraries={todayItineraries} todayLabel={todayLabel} />
      )}

      {loading && (
        <div style={{ margin: '12px 18px', fontFamily: F.hand, color: '#7a736a', fontSize: 15 }}>
          Loading schedule…
        </div>
      )}

      {err && (
        <div style={{ margin: '12px 18px', padding: 12, background: C.red + '22', borderRadius: 12, fontFamily: F.hand, color: C.red, fontSize: 14 }}>
          Couldn't load schedule — {err}
        </div>
      )}

      <DatePickerStrip value={dateIdx} onChange={setDateIdx} dates={dates} />

      {ferryMock && !loading && (
        <div style={{ margin: '0 18px 8px', fontFamily: F.hand, fontSize: 12, color: '#9b958c' }}>
          ⚠ estimated ferry times · live schedule ingests daily at 6am ET
        </div>
      )}

      {!loading && (
        <>
          <Legend sort={sort} onSort={setSort} />
          <div>
            {itineraries.length === 0 && !err ? (
              <div style={{ margin: '12px 18px', fontFamily: F.hand, color: '#7a736a', fontSize: 15 }}>
                No trips found for this day.
              </div>
            ) : (
              itineraries.map(it => (
                <ItineraryRow key={it.id} it={it} direction={direction} dateLabel={selectedDateLabel} />
              ))
            )}
          </div>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 10px' }}>
        <Wave width={120} />
      </div>
      <div style={{ textAlign: 'center', fontFamily: F.hand, fontSize: 13, color: '#9b958c', paddingBottom: 24 }}>
        ferry data scraped daily · LIRR via open feed
      </div>
    </div>
  );
}
