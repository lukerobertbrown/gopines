import { useState, useEffect, useContext, createContext, type CSSProperties, type ReactNode, type MouseEvent } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
// Palette ported from the GoDash design (DoorDash-styled re-skin). `coral` and
// `gold` collapse to the same DoorDash red — that's the design intent. `yellow`
// is an off-palette literal kept around for sprites that need to stay yellow
// (sun, sparkle) regardless of the brand red elsewhere.
const GODASH_PALETTE = {
  sand:  '#FAF6F0',  // very subtle warm white — page background
  paper: '#FFFFFF',  // card / header background
  ink:   '#191919',  // DoorDash near-black
  ocean: '#131A2C',  // midnight blue — hero "to-penn" bg
  deep:  '#000000',  // pairs with ocean
  coral: '#EB1700',  // DoorDash red — primary accent + hero "to-pines" bg
  gold:  '#EB1700',  // same red (design folds gold into the brand red)
  pink:  '#FFB199',  // soft salmon — ferry flag
  red:   '#C92033',  // semantic, kept readable on white
  amber: '#F2BB05',
  green: '#00854D',
  mint:  '#EEF1F4',  // soft cool grey — bus body
  yellow:'#FFC60A',  // off-palette literal for sun/sparkle sprites
} as const;

// Module-level alias — used by non-component utilities (slInfo, etc.).
// Components shadow this with `const C = useTheme()` at their function top.
const C = GODASH_PALETTE;

type SkinPalette = typeof GODASH_PALETTE;

type Skin = {
  id: string;
  label: string;
  palette: SkinPalette;
};

const SKINS: Skin[] = [
  { id: 'godash-may26', label: "DoorDash - May'26", palette: GODASH_PALETTE },
];

const ThemeContext = createContext<SkinPalette>(GODASH_PALETTE);
const useTheme = () => useContext(ThemeContext);

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
  daysOfWeek?: number[] | null;  // 0=Sun..6=Sat; null/undefined = applies to all days
  dayLabel?: string | null;
  extraStops?: boolean;            // ▲: boats that stop at Cherry Grove en route
  effectiveStart?: string | null;  // YYYY-MM-DD; trip is unavailable on dates before this
  effectiveEnd?: string | null;    // YYYY-MM-DD; trip is unavailable on dates after this
};

type FerryResp = {
  trips: FerryTrip[];
  effectiveLabel?: string;
  scheduleTitle?: string | null;
  effectiveDateRange?: string | null;
  sourcePageUrl?: string;
  pdfUrl?: string | null;
  updatedAt?: string;
  error?: string;
};

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

// ─── Analytics ────────────────────────────────────────────────────────────────
// Lightweight gtag wrapper. The Google tag is injected by index.html, so
// `window.gtag` exists in normal browsers. Adblockers / privacy extensions
// strip the script, in which case `window.gtag` is undefined — `track()`
// no-ops silently rather than crashing.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

type TrackPayload = {
  direction: 'to-pines' | 'to-penn';
  trip_date: string;     // YYYY-MM-DD (the trip's date, not the date of the event)
  depart_time: string;   // HH:MM
  total_min: number;
  stoplight: 'green' | 'amber' | 'red';
  surface: 'card' | 'hero';
};

function track(name: string, params: TrackPayload) {
  try { window.gtag?.('event', name, params); } catch (_) { /* swallow */ }
}

// Hero countdown: "Xm" if under an hour, "Xh Ym" between 1–2h, "~Xh"
// (rounded, with leading tilde) for anything 2h or longer.
function countdownStr(totalMin: number): string {
  if (totalMin < 60) return `${totalMin}m`;
  if (totalMin < 120) {
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return `${h}h ${m}m`;
  }
  return `~${Math.round(totalMin / 60)}h`;
}

// Trip classification:
//   • long (red)   = 3h+ door-to-door, regardless of layover
//   • risky (amber)= short trip but tight (<20 min) Sayville transfer
//   • best (green) = short trip with a comfortable (≥20 min) Sayville layover
const COMFORT_LAYOVER_MIN = 20;
const AVOID_TOTAL_MIN = 180;
function sl(totalMin: number, layoverMin: number): Stoplight {
  if (totalMin >= AVOID_TOTAL_MIN) return 'red';
  return layoverMin >= COMFORT_LAYOVER_MIN ? 'green' : 'amber';
}

function slInfo(s: Stoplight) {
  return s === 'green' ? { bg: C.green, label: 'best'  }
       : s === 'amber' ? { bg: C.amber, label: 'risky' }
       :                 { bg: C.red,   label: 'long'  };
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

function ferriesForDay(ferries: FerryTrip[], dow: number, dateStr?: string): FerryTrip[] {
  return ferries.filter(f => {
    // null / undefined / [] all mean "no day restriction" (legacy and mock data
    // produce missing-or-empty daysOfWeek; an empty list shouldn't filter
    // every day out).
    if (Array.isArray(f.daysOfWeek) && f.daysOfWeek.length > 0 && !f.daysOfWeek.includes(dow)) return false;
    if (dateStr) {
      if (f.effectiveStart && dateStr < f.effectiveStart) return false;
      if (f.effectiveEnd && dateStr > f.effectiveEnd) return false;
    }
    return true;
  });
}

function buildToPines(outbound: Journey[], ferries: FerryTrip[], dow: number, dateStr?: string): Itinerary[] {
  const dayFerries = ferriesForDay(ferries, dow, dateStr);
  const pines = dayFerries
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
      layover, total, stoplight: sl(total, layover),
      segments,
    });
  }
  return result;
}

function buildToPenn(inbound: Journey[], ferries: FerryTrip[], dow: number, dateStr?: string): Itinerary[] {
  const dayFerries = ferriesForDay(ferries, dow, dateStr);
  const hasPenn = dayFerries.some(f => f.direction === 'pines_to_sayville');
  const pennDeps = dayFerries
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
      layover, total, stoplight: sl(total, layover),
      segments,
    });
  }
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
  const C = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={style}>
      <path d="M10 1 L11.5 8.5 L19 10 L11.5 11.5 L10 19 L8.5 11.5 L1 10 L8.5 8.5 Z"
        fill={C.yellow} stroke={C.ink} strokeWidth="0.8" strokeLinejoin="round" filter="url(#wobble)" />
    </svg>
  );
}

function Sun({ size = 60, style = {} }: { size?: number; style?: CSSProperties }) {
  const C = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={style}>
      <g filter="url(#wobble)">
        <circle cx="50" cy="50" r="20" fill={C.yellow} stroke={C.ink} strokeWidth="2" />
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
  const C = useTheme();
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
  const C = useTheme();
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
  const C = useTheme();
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
  const C = useTheme();
  return (
    <svg width={size} height={size * 0.78} viewBox="0 0 36 28">
      <g filter="url(#wobble)">
        <circle cx="28" cy="7" r="3.2" fill={C.yellow} stroke={C.ink} strokeWidth="1" />
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
  const C = useTheme();
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
// Build an ICS DTSTART/DTEND value (no Z; uses TZID=America/New_York from
// the wrapping property). dateStr is "YYYY-MM-DD"; hhmm is "HH:MM" (or
// "25:30" for after-midnight arrivals — addMin doesn't mod 24, so we honour
// the rollover here so the calendar event lands on the correct day).
function hhmmToIcsDateTime(dateStr: string, hhmm: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hRaw, mnRaw] = (hhmm || '').slice(0, 5).split(':').map(Number);
  const totalMins = (hRaw || 0) * 60 + (mnRaw || 0);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCMinutes(dt.getUTCMinutes() + totalMins);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const mins = String(dt.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mins}00`;
}

// RFC 5545 line folding & escape rules — newlines in TEXT properties become
// literal "\n", commas/semicolons/backslashes get backslash-escaped.
function icsEscape(text: string): string {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function buildIcs(opts: {
  dateStr: string;
  departRaw: string;
  arriveRaw: string;
  summary: string;
  description: string;
  location: string;
  uid: string;
}): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//gopines.gay//Trip//EN',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/New_York:${hhmmToIcsDateTime(opts.dateStr, opts.departRaw)}`,
    `DTEND;TZID=America/New_York:${hhmmToIcsDateTime(opts.dateStr, opts.arriveRaw)}`,
    `SUMMARY:${icsEscape(opts.summary)}`,
    `DESCRIPTION:${icsEscape(opts.description)}`,
    `LOCATION:${icsEscape(opts.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function CalendarInviteButton({
  it, direction, dateStr, dateLabel, style = {},
}: {
  it: Itinerary;
  direction: 'to-pines' | 'to-penn';
  dateStr: string;
  dateLabel: string;
  style?: CSSProperties;
}) {
  const C = useTheme();
  const [added, setAdded] = useState(false);

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    const toPines = direction === 'to-pines';
    const summary = toPines ? 'Pines bound' : 'Heading to Penn';
    const firstSeg = it.segments[0];
    const location = firstSeg ? firstSeg.fromTo.split(' → ')[0] : (toPines ? 'Penn Station' : 'Pines Ferry');
    const description = buildShareText(direction, dateLabel, it.segments);
    const uid = `gopines-${dateStr}-${it.departRaw.replace(':', '')}-${direction}@gopines.gay`;
    const ics = buildIcs({
      dateStr,
      departRaw: it.departRaw,
      arriveRaw: it.arriveRaw,
      summary,
      description,
      location,
      uid,
    });
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gopines-${dateStr}-${it.departRaw.replace(':', '')}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    track('add_to_calendar', {
      direction,
      trip_date: dateStr,
      depart_time: it.departRaw,
      total_min: it.total,
      stoplight: it.stoplight,
      surface: 'card',
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  };

  return (
    <button onClick={onClick} aria-label="add trip to calendar" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      border: '1.2px solid ' + C.ink,
      background: 'rgba(255,255,255,0.7)', color: C.ink, cursor: 'pointer',
      borderRadius: 999, padding: '3px 9px',
      fontFamily: F.marker, fontSize: 11, letterSpacing: 0.6,
      boxShadow: '1px 1.5px 0 ' + C.ink,
      ...style,
    }}>
      <svg width="11" height="11" viewBox="0 0 14 14">
        <g stroke={C.ink} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#wobble)">
          <rect x="1.5" y="3" width="11" height="9.5" rx="1.2" />
          <line x1="1.5" y1="6" x2="12.5" y2="6" />
          <line x1="4" y1="1.5" x2="4" y2="4" />
          <line x1="10" y1="1.5" x2="10" y2="4" />
        </g>
      </svg>
      {added ? 'ADDED' : 'ADD'}
    </button>
  );
}

function ShareButton({ text, tone = 'light', style = {}, trackPayload }: {
  text: string;
  tone?: 'light' | 'dark';
  style?: CSSProperties;
  // Optional GA4 payload — when present, fires `share_trip` after a
  // successful share. Omitted by callers that don't want analytics.
  trackPayload?: TrackPayload;
}) {
  const C = useTheme();
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
      if (trackPayload) track('share_trip', trackPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (_) { /* cancelled — no event */ }
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
  const C = useTheme();
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
                  {k === 'to-pines' ? 'To the Pines' : 'From the Pines'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SketchBox>
  );
}

function NextHero({ direction, itineraries, todayLabel, todayStr }: {
  direction: 'to-pines' | 'to-penn';
  itineraries: Itinerary[];   // always today's, earliest-first
  todayLabel: string;          // formatted, e.g. "Sat May 9, 2026"
  todayStr: string;            // YYYY-MM-DD for analytics payloads
}) {
  const C = useTheme();
  const toPines = direction === 'to-pines';
  const nowM = toMin(nowNY());
  const next = itineraries.find(it => toMin(it.departRaw) > nowM) ?? itineraries[0];

  if (!next) {
    return (
      <div style={{ margin: '2px 18px 12px' }}>
        <SketchBox color={C.ink} fill={toPines ? C.gold : C.ocean} radius={20} sw={1.8} pad={14}>
          <div style={{ fontFamily: F.hand, color: '#FFFFFF', fontSize: 15 }}>
            {toPines ? 'No more trains today — check back tomorrow!' : 'No more ferries today — see you next time!'}
          </div>
        </SketchBox>
      </div>
    );
  }

  const diffMin = toMin(next.departRaw) - nowM;
  const showCountdown = diffMin > 0 && diffMin < 12 * 60;
  const title = toPines ? 'NEXT TRAIN FROM PENN' : 'NEXT FERRY OFF THE PINES';
  const trainSegs = next.segments.filter(s => s.kind === 'train');
  const ferrySeg  = next.segments.find(s => s.kind === 'ferry');
  const trainPart = trainSegs.map(t => {
    const dest = t.fromTo.split(' → ')[1] || t.fromTo;
    return t.name ? `${dest} (${t.name})` : dest;
  });
  const ferryPart = ferrySeg ? `${ferrySeg.time} ferry` : '';
  const subParts = toPines ? [...trainPart, ferryPart] : [ferryPart, ...trainPart];
  const sub = subParts.filter(Boolean).join(' → ');
  const shareText = buildShareText(direction, todayLabel, next.segments);
  const slBg    = next.stoplight === 'green' ? C.green : C.amber;
  const slLabel = next.stoplight === 'green' ? 'best' : 'risky';

  return (
    <div style={{ margin: '2px 18px 12px', position: 'relative' }}>
      <SketchBox color={C.ink} fill={toPines ? C.gold : C.ocean} radius={20} sw={1.8} pad={0}>
        <div style={{ padding: '12px 14px 14px', position: 'relative', overflow: 'hidden' }}>

          {/* Top row: title + countdown on the left, stoplight chip on the right */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ fontFamily: F.hand, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.3, lineHeight: 1.2, flex: 1, minWidth: 0 }}>
              {title}
              {showCountdown && (
                <span style={{ fontFamily: F.marker, color: '#FFFFFF' }}>
                  {' · in '}{countdownStr(diffMin)}
                </span>
              )}
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 9px', borderRadius: 999,
              background: 'rgba(255,255,255,0.6)',
              border: '1.2px solid ' + C.ink,
              flex: '0 0 auto',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: 999, background: slBg,
                border: '1px solid ' + C.ink, display: 'inline-block',
              }} />
              <span style={{ fontFamily: F.marker, fontSize: 11, color: C.ink, letterSpacing: 0.4 }}>{slLabel}</span>
              <span style={{ fontFamily: F.hand, fontSize: 11, color: '#5a544c' }}>· {hmStr(next.total)}</span>
            </div>
          </div>

          {/* Big disco time */}
          <div style={{ fontFamily: F.disco, fontSize: 34, letterSpacing: 1.5, color: '#FFFFFF', lineHeight: 1, marginTop: 6 }}>
            {next.depart.toUpperCase()}
          </div>

          {/* Subtitle (route summary) */}
          <div style={{ fontFamily: F.hand, fontSize: 14, marginTop: 4, color: '#FFFFFF', lineHeight: 1.25, maxWidth: 'calc(100% - 80px)' }}>
            {sub}
          </div>

          {/* Animated sprite — pushed below the rating chip with breathing room */}
          <div style={{
            position: 'absolute', right: 14, bottom: 36, opacity: 0.95,
            animation: toPines ? 'wf-chug 2.6s ease-in-out infinite' : 'wf-sail 4.2s ease-in-out infinite',
          }}>
            {toPines ? <Train size={52} puff /> : <Ferry size={52} wakes />}
          </div>

          <ShareButton tone={toPines ? 'light' : 'dark'} text={shareText}
            trackPayload={{
              direction,
              trip_date: todayStr,
              depart_time: next.departRaw,
              total_min: next.total,
              stoplight: next.stoplight,
              surface: 'hero',
            }}
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

function buildShareText(direction: 'to-pines' | 'to-penn', dateLabel: string, segments: Segment[]): string {
  const dirLabel = direction === 'to-pines' ? 'To the Pines' : 'From the Pines';
  const bullets = segments.map(s => {
    const tail = s.name ? ` (${s.name})` : '';
    return `• ${s.time} — ${s.fromTo}${tail}`;
  }).join('\n');
  return `${dateLabel}\n${dirLabel}\n\n${bullets}\n\ngopines.gay`;
}

function ItineraryRow({ it, direction, dateLabel, dateStr }: {
  it: Itinerary;
  direction: 'to-pines' | 'to-penn';
  dateLabel: string;
  dateStr: string;
}) {
  const C = useTheme();
  const { bg, label } = slInfo(it.stoplight);
  const shareText = buildShareText(direction, dateLabel, it.segments);

  return (
    <SketchBox color={C.ink} fill={C.paper} radius={18} sw={1.6} pad={0}
      style={{ margin: '0 18px 12px', position: 'relative' }}>
      <div style={{ padding: '10px 14px 14px' }}>

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
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: 30,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <SegmentSprite kind={seg.kind} animated={false} />
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

        {/* Action row: calendar invite + share */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
          <CalendarInviteButton it={it} direction={direction} dateStr={dateStr} dateLabel={dateLabel} />
          <ShareButton
            text={shareText}
            trackPayload={{
              direction,
              trip_date: dateStr,
              depart_time: it.departRaw,
              total_min: it.total,
              stoplight: it.stoplight,
              surface: 'card',
            }}
          />
        </div>
      </div>
    </SketchBox>
  );
}

function DatePickerStrip({ value, onChange, dates }: {
  value: number;
  onChange: (i: number) => void;
  dates: ReturnType<typeof rollingDates>;
}) {
  const C = useTheme();
  return (
    <div style={{ margin: '6px 0 10px' }}>
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

function FilterBar({
  qualities, onToggleQ,
  sort, onSort,
}: {
  qualities: Stoplight[];
  onToggleQ: (s: Stoplight) => void;
  sort: 'earliest' | 'latest';
  onSort: (s: 'earliest' | 'latest') => void;
}) {
  const C = useTheme();
  const QUALITY_LABEL: Record<Stoplight, string> = { green: 'best', amber: 'risky', red: 'long' };
  const QUALITY_BG: Record<Stoplight, string> = { green: C.green, amber: C.amber, red: C.red };

  const segShell: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 2,
    border: '1.2px solid ' + C.ink, borderRadius: 999,
    background: C.paper, padding: 2,
  };
  const segBtn = (on: boolean): CSSProperties => ({
    border: 'none',
    background: on ? C.ink : 'transparent',
    color: on ? C.paper : '#5a544c',
    fontFamily: F.marker, fontSize: 12, letterSpacing: 0.5,
    padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
  });

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', margin: '2px 18px 8px', flexWrap: 'wrap' }}>
      <div style={segShell}>
        {(['green', 'amber', 'red'] as const).map(k => {
          const on = qualities.includes(k);
          return (
            <button key={k} onClick={() => onToggleQ(k)} style={{
              ...segBtn(on),
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: 999,
                background: QUALITY_BG[k],
                border: '1px solid ' + (on ? C.paper : C.ink),
                display: 'inline-block',
              }} />
              {QUALITY_LABEL[k]}
            </button>
          );
        })}
      </div>
      <div style={segShell}>
        {(['earliest', 'latest'] as const).map(k => (
          <button key={k} onClick={() => onSort(k)} style={segBtn(sort === k)}>
            {k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

function DiscoHeader({ onMenuOpen }: { onMenuOpen: () => void }) {
  const C = useTheme();
  return (
    <div style={{ padding: '16px 18px 10px', position: 'relative' }}>
      <div style={{ fontFamily: F.disco, fontSize: 28, letterSpacing: 1.5, color: C.ink, lineHeight: 1 }}>
        GOPINES.GAY
      </div>
      <button
        onClick={onMenuOpen}
        aria-label="open menu"
        style={{
          position: 'absolute', top: 10, right: 14,
          border: 'none', background: 'transparent', padding: 0,
          cursor: 'pointer', borderRadius: '50%',
        }}
      >
        <Sun size={42} />
      </button>
      <div style={{ position: 'absolute', top: 24, right: 64, pointerEvents: 'none' }}><Seagull size={18} /></div>
      <div style={{ position: 'absolute', top: 40, right: 78, pointerEvents: 'none' }}><Seagull size={12} /></div>
    </div>
  );
}

// ─── Menu / overlay panel ─────────────────────────────────────────────────────
type PanelView = 'closed' | 'menu' | 'ferry' | 'about' | 'home-station' | 'skins';

type HomeStation = 'penn';

const HOME_STATION_KEY = 'gopines_home_station';

function MenuLink({ label, onClick }: { label: string; onClick: () => void }) {
  const C = useTheme();
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left',
      border: 'none', background: 'transparent', cursor: 'pointer',
      padding: '14px 0', fontFamily: F.marker, fontSize: 22, color: C.ink,
      letterSpacing: 0.5, borderBottom: '1.5px dashed ' + C.ink,
    }}>
      {label} <span style={{ float: 'right', fontFamily: F.hand, fontSize: 18 }}>›</span>
    </button>
  );
}

// Sort key putting Mon=1..Sat=6 first, Sun=0 last so weekly grouping reads naturally.
function dowSortKey(d: number) { return d === 0 ? 7 : d; }

// Shorten weekday names in a date range string ("Friday, April 17 thru
// Wednesday, May 20" → "Fri, April 17 thru Wed, May 20") so the header reads
// compactly under the schedule title.
// Whitelist external links sourced from Firestore. The data is server-controlled
// today (Admin SDK only — clients can't write), but the parser pulls a URL out
// of the Wix page so we still validate before rendering as a clickable link to
// avoid a phishing surface if the upstream PNG/PDF is ever poisoned with a
// crafted URL.
const SOURCE_URL_HOSTS = new Set(["sayvilleferry.com", "www.sayvilleferry.com"]);
function safeSourceUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!SOURCE_URL_HOSTS.has(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// "2026-05-11" → "May 11" (used to render trip-level effectiveStart/End notes).
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[parseInt(m[2], 10) - 1] ?? m[2];
  const day = parseInt(m[3], 10);
  return `${month} ${day}`;
}

// Build a short human label for a trip's effective-date range, e.g.:
//   STARTS MAY 11    → "starts May 11"
//   ENDS MAY 20      → "ends May 20"
//   APRIL 10 ONLY    → "Apr 10 only"
//   STARTS+ENDS      → "May 11 — May 20"
function effectiveLabel(t: FerryTrip): string {
  const s = t.effectiveStart || null;
  const e = t.effectiveEnd || null;
  if (s && e && s === e) return `${shortDate(s)} only`;
  if (s && e) return `${shortDate(s)} — ${shortDate(e)}`;
  if (s) return `starts ${shortDate(s)}`;
  if (e) return `ends ${shortDate(e)}`;
  return '';
}

function shortenWeekdays(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/Monday/g, 'Mon')
    .replace(/Tuesday/g, 'Tue')
    .replace(/Wednesday/g, 'Wed')
    .replace(/Thursday/g, 'Thu')
    .replace(/Friday/g, 'Fri')
    .replace(/Saturday/g, 'Sat')
    .replace(/Sunday/g, 'Sun');
}

// Display order for the per-day cards: Mon → Sat first, then Sun at the end.
const DAY_CARDS: { idx: number; label: string }[] = [
  { idx: 1, label: 'Monday' },
  { idx: 2, label: 'Tuesday' },
  { idx: 3, label: 'Wednesday' },
  { idx: 4, label: 'Thursday' },
  { idx: 5, label: 'Friday' },
  { idx: 6, label: 'Saturday' },
  { idx: 0, label: 'Sunday' },
];

function FerryScheduleView({ ferryData, ferryMock }: { ferryData: FerryResp | null; ferryMock: boolean }) {
  const C = useTheme();
  const [tab, setTab] = useState<'to-pines' | 'to-penn'>('to-pines');
  const trips = ferryData?.trips ?? [];
  const filtered = trips.filter(t => tab === 'to-pines'
    ? (t.direction === 'sayville_to_pines' || t.direction === 'unknown')
    : (t.direction === 'pines_to_sayville' ||
       (t.direction === 'unknown' && !trips.some(x => x.direction === 'pines_to_sayville'))));

  // Fan trips out into per-day buckets so a Mon–Wed parsed entry contributes to
  // each of Monday, Tuesday, and Wednesday's cards independently.
  const byDay = new Map<number, FerryTrip[]>();
  for (const t of filtered) {
    const days = Array.isArray(t.daysOfWeek) && t.daysOfWeek.length
      ? t.daysOfWeek
      : DAY_CARDS.map(d => d.idx);   // legacy/mock entries fall back to "every day"
    for (const d of days) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(t);
    }
  }
  // Per-day sort + dedupe (so two Mon–Wed entries with the same time/triangle
  // collapse to one).
  for (const [d, list] of byDay) {
    const seen = new Set<string>();
    byDay.set(d, list
      .slice()
      .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
      .filter(t => {
        const k = `${t.departureTime}-${t.extraStops ? '1' : '0'}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }));
  }
  const dayCards = DAY_CARDS.map(d => ({ ...d, trips: byDay.get(d.idx) ?? [] }));
  const haveAnyTrips = dayCards.some(d => d.trips.length > 0);
  const haveAnyTriangle = dayCards.some(d => d.trips.some(t => t.extraStops));

  const title = ferryData?.scheduleTitle || 'Ferry Schedule';
  const dateRange = shortenWeekdays(ferryData?.effectiveDateRange);

  return (
    <div>
      {/* Page header: scraped schedule title + date range */}
      <div style={{
        fontFamily: F.disco, fontSize: 22, letterSpacing: 1.5,
        color: C.ink, lineHeight: 1.1,
      }}>
        {title.toUpperCase()}
      </div>
      {dateRange && (
        <div style={{
          fontFamily: F.hand, fontSize: 14, color: '#7a736a',
          marginTop: 4,
        }}>
          {dateRange}
        </div>
      )}
      {ferryMock && (
        <div style={{ fontFamily: F.hand, fontSize: 12, color: '#9b958c', marginTop: 6 }}>
          ⚠ estimated times — live schedule loads daily at 6am ET
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, margin: '14px 0',
        border: '1.6px solid ' + C.ink, borderRadius: 999, padding: 3,
        background: C.paper,
      }}>
        {(['to-pines', 'to-penn'] as const).map(k => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)} style={{
              flex: 1, cursor: 'pointer',
              background: on ? (k === 'to-pines' ? C.coral : C.deep) : 'transparent',
              color: on ? '#fff' : '#5a544c',
              fontFamily: F.marker, fontSize: 14, letterSpacing: 0.4,
              padding: '8px 6px', borderRadius: 999,
              boxShadow: on ? '1.5px 2px 0 ' + C.ink : 'none',
              border: on ? '1.4px solid ' + C.ink : '1.4px solid transparent',
            }}>
              {k === 'to-pines' ? '→ Pines' : '→ Sayville'}
            </button>
          );
        })}
      </div>

      {!haveAnyTrips ? (
        <div style={{ fontFamily: F.hand, fontSize: 14, color: '#7a736a' }}>
          No ferry times found for this direction.
        </div>
      ) : (
        dayCards.map(d => {
          const half = Math.ceil(d.trips.length / 2);
          const left = d.trips.slice(0, half);
          const right = d.trips.slice(half);
          const renderItem = (t: FerryTrip) => {
            const eff = effectiveLabel(t);
            return (
              <li key={t.departureTime + (t.extraStops ? 'x' : '') + (eff || '')} style={{
                display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6,
                padding: '3px 0',
              }}>
                <span style={{ letterSpacing: 0.3 }}>{fmt(t.departureTime)}</span>
                {t.extraStops && (
                  <span
                    title="Boats stop at Cherry Grove en route"
                    aria-label="stops at Cherry Grove"
                    style={{
                      fontFamily: F.marker, fontSize: 14, color: C.coral,
                      flex: '0 0 auto',
                    }}
                  >
                    ▲
                  </span>
                )}
                {eff && (
                  <span
                    title={`Effective: ${eff}`}
                    style={{
                      fontFamily: F.hand, fontSize: 11, color: '#9b958c',
                      lineHeight: 1.2,
                    }}
                  >
                    {eff}
                  </span>
                )}
              </li>
            );
          };
          return (
            <SketchBox key={d.idx} color={C.ink} fill={C.paper} radius={14} sw={1.6} pad={0}
              style={{ marginBottom: 14 }}>
              <div style={{ padding: '10px 14px 12px' }}>
                <div style={{
                  fontFamily: F.marker, fontSize: 16, letterSpacing: 0.6,
                  color: C.ink, marginBottom: 8, textTransform: 'uppercase',
                  borderBottom: '1.2px dashed ' + C.ink, paddingBottom: 6,
                }}>
                  {d.label}
                </div>
                {d.trips.length === 0 ? (
                  <div style={{ fontFamily: F.hand, fontSize: 13, color: '#9b958c' }}>
                    No service.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 14, fontFamily: F.marker, fontSize: 16, color: C.ink }}>
                    <ol start={1} style={{
                      flex: 1, margin: 0, paddingInlineStart: 22,
                    }}>
                      {left.map(renderItem)}
                    </ol>
                    {right.length > 0 && (
                      <ol start={half + 1} style={{
                        flex: 1, margin: 0, paddingInlineStart: 22,
                      }}>
                        {right.map(renderItem)}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            </SketchBox>
          );
        })
      )}

      {/* Cherry Grove footnote */}
      {haveAnyTriangle && (
        <div style={{
          fontFamily: F.hand, fontSize: 12, color: '#7a736a',
          marginTop: 4, marginBottom: 12,
        }}>
          <span style={{ color: C.coral, fontFamily: F.marker, marginRight: 4 }}>▲</span>
          stops at Cherry Grove en route to / from the Pines
        </div>
      )}

      {(() => {
        const safeUrl = safeSourceUrl(ferryData?.sourcePageUrl);
        if (!safeUrl) return null;
        return (
          <div style={{ marginTop: 14, fontFamily: F.hand, fontSize: 13, color: '#5a544c', textAlign: 'center' }}>
            Source: <a href={safeUrl} target="_blank" rel="noreferrer" style={{ color: C.deep, textDecoration: 'underline' }}>
              sayvilleferry.com
            </a>
          </div>
        );
      })()}
    </div>
  );
}

function AboutView() {
  const C = useTheme();
  return (
    <div>
      <div style={{ fontFamily: F.disco, fontSize: 22, letterSpacing: 1.5, color: C.ink, marginBottom: 14 }}>
        ABOUT
      </div>
      <div style={{ fontFamily: F.hand, fontSize: 17, color: C.ink, lineHeight: 1.45 }}>
        <p style={{ marginTop: 0 }}>
          gopines.gay is a side project — a weekend toy that pairs the LIRR open feed with
          the Sayville Ferry schedule so getting to Fire Island Pines (or back) is one tap easier.
        </p>
        <p>
          Times come straight from the MTA's GTFS feed and a daily scrape of the Sayville
          Ferry schedule. No accounts, no ads.
        </p>
        <p>
          If you appreciate this free resource and want to give back, please consider{' '}
          <a
            href="https://www.fippoa.org/what-we-do/#donate-today"
            target="_blank"
            rel="noreferrer"
            style={{ color: C.deep, textDecoration: 'underline' }}
          >
            donating to FIPPOA
          </a>
          {' '}to support the work that keeps our community humming.
        </p>
        <p style={{ marginBottom: 0 }}>
          See you at tea ☀️🌊
        </p>
      </div>
    </div>
  );
}

const STATIONS: { id: HomeStation | string; label: string; available: boolean }[] = [
  { id: 'penn',     label: 'Penn Station',     available: true  },
  { id: 'grand-central', label: 'Grand Central',    available: false },
  { id: 'atlantic', label: 'Atlantic Terminal', available: false },
  { id: 'woodside', label: 'Woodside',          available: false },
];

function HomeStationView({
  selected, onSelect,
}: { selected: HomeStation; onSelect: (s: HomeStation) => void }) {
  const C = useTheme();
  return (
    <div>
      <div style={{ fontFamily: F.hand, fontSize: 14, color: '#9b958c', marginBottom: 16, lineHeight: 1.5 }}>
        Choose your departure hub. The app will default to showing trains from this station.
      </div>
      {STATIONS.map(s => (
        <button
          key={s.id}
          disabled={!s.available}
          onClick={() => s.available && onSelect(s.id as HomeStation)}
          style={{
            display: 'flex', alignItems: 'center', width: '100%',
            border: 'none', background: 'transparent',
            padding: '13px 0', cursor: s.available ? 'pointer' : 'default',
            borderBottom: '1.5px dashed ' + (s.available ? C.ink : '#d0ccc7'),
            gap: 12,
          }}
        >
          <span style={{
            width: 22, height: 22, flexShrink: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            border: '1.5px solid ' + (s.available ? C.ink : '#c8c3bd'),
            borderRadius: 4,
            background: selected === s.id ? C.ink : 'transparent',
            color: C.paper,
            fontSize: 13, fontWeight: 700,
          }}>
            {selected === s.id && '✓'}
          </span>
          <span style={{
            fontFamily: F.marker, fontSize: 20,
            color: s.available ? C.ink : '#b5b0aa',
            letterSpacing: 0.4,
          }}>
            {s.label}
          </span>
          {!s.available && (
            <span style={{ marginLeft: 'auto', fontFamily: F.hand, fontSize: 12, color: '#c0bbb5' }}>
              coming soon
            </span>
          )}
        </button>
      ))}
      <button
        onClick={() => {}}
        style={{
          display: 'block', width: '100%', marginTop: 20,
          padding: '12px 0', textAlign: 'center',
          border: '1.5px dashed ' + C.ink, borderRadius: 8,
          background: 'transparent', cursor: 'pointer',
          fontFamily: F.marker, fontSize: 17, color: C.ink,
          letterSpacing: 0.4,
        }}
      >
        Request a Station
      </button>
    </div>
  );
}

function SkinsView({
  skins, activeSkinId, onSelect,
}: {
  skins: Skin[];
  activeSkinId: string;
  onSelect: (id: string) => void;
}) {
  const C = useTheme();
  const SWATCHES: (keyof SkinPalette)[] = ['coral', 'ocean', 'sand', 'green', 'amber', 'ink'];
  return (
    <div>
      <div style={{ fontFamily: F.disco, fontSize: 22, letterSpacing: 1.5, color: C.ink, marginBottom: 14 }}>
        SKINS
      </div>
      {skins.map(skin => {
        const active = skin.id === activeSkinId;
        return (
          <button
            key={skin.id}
            onClick={() => onSelect(skin.id)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              border: '1.6px solid ' + C.ink,
              borderRadius: 14,
              background: active ? C.coral : C.paper,
              cursor: 'pointer',
              padding: 12,
              marginBottom: 12,
              boxShadow: active ? '2px 3px 0 ' + C.ink : '1.5px 2px 0 ' + C.ink,
              transform: active ? 'translate(-1px,-1px)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                fontFamily: F.marker, fontSize: 18,
                color: active ? '#fff' : C.ink,
                letterSpacing: 0.4,
              }}>
                {skin.label}
              </span>
              {active && (
                <span style={{ fontFamily: F.hand, fontSize: 16, color: '#fff' }}>✓</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {SWATCHES.map(key => (
                <span key={key} style={{
                  width: 20, height: 20, borderRadius: 999,
                  background: skin.palette[key],
                  border: '1.2px solid ' + (active ? 'rgba(255,255,255,0.5)' : C.ink),
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MenuPanel({
  view, setView, ferryData, ferryMock, homeStation, setHomeStation, skins, activeSkinId, onSkinSelect,
}: {
  view: PanelView;
  setView: (v: PanelView) => void;
  ferryData: FerryResp | null;
  ferryMock: boolean;
  homeStation: HomeStation;
  setHomeStation: (s: HomeStation) => void;
  skins: Skin[];
  activeSkinId: string;
  onSkinSelect: (id: string) => void;
}) {
  const C = useTheme();
  const open = view !== 'closed';

  return (
    <div
      aria-hidden={!open}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 50, pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={() => setView('closed')}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(42,38,34,0.32)',
          opacity: open ? 1 : 0,
          transition: 'opacity .25s ease',
        }}
      />
      {/* Sliding sheet */}
      <div style={{
        position: 'absolute', top: 0, left: '50%', transform: `translateX(-50%) translateY(${open ? '0' : '-105%'})`,
        width: '100%', maxWidth: 430,
        background: `linear-gradient(180deg, ${C.sand} 0%, ${C.paper} 100%)`,
        borderBottom: '2px solid ' + C.ink,
        boxShadow: '0 6px 0 ' + C.ink,
        transition: 'transform .3s ease',
        maxHeight: '94vh', overflowY: 'auto',
        padding: '14px 18px 24px',
      }}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {view === 'menu' ? (
            <div style={{ fontFamily: F.disco, fontSize: 22, letterSpacing: 1.5, color: C.ink }}>
              MENU
            </div>
          ) : (
            <button onClick={() => setView('menu')} style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: F.marker, fontSize: 16, color: C.ink, padding: '4px 0',
            }}>
              ‹ menu
            </button>
          )}
          <button onClick={() => setView('closed')} aria-label="close menu" style={{
            border: '1.4px solid ' + C.ink, background: C.paper, cursor: 'pointer',
            width: 34, height: 34, borderRadius: 999,
            fontFamily: F.marker, fontSize: 18, color: C.ink,
            boxShadow: '1.5px 2px 0 ' + C.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            paddingBottom: 2,
          }}>×</button>
        </div>

        {view === 'menu' && (
          <div>
            <MenuLink label="Ferry Schedule" onClick={() => setView('ferry')} />
            <MenuLink label="Home Station"   onClick={() => setView('home-station')} />
            <MenuLink label="Skins"          onClick={() => setView('skins')} />
            <MenuLink label="About"          onClick={() => setView('about')} />
          </div>
        )}
        {view === 'ferry'        && <FerryScheduleView ferryData={ferryData} ferryMock={ferryMock} />}
        {view === 'home-station' && <HomeStationView selected={homeStation} onSelect={s => { setHomeStation(s); }} />}
        {view === 'about'        && <AboutView />}
        {view === 'skins'        && <SkinsView skins={skins} activeSkinId={activeSkinId} onSelect={onSkinSelect} />}
      </div>
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
  const [panel, setPanel]         = useState<PanelView>('closed');
  const [homeStation, setHomeStationState] = useState<HomeStation>(
    () => (localStorage.getItem(HOME_STATION_KEY) as HomeStation | null) ?? 'penn'
  );
  const setHomeStation = (s: HomeStation) => {
    localStorage.setItem(HOME_STATION_KEY, s);
    setHomeStationState(s);
  };
  const [qualities, setQualities] = useState<Stoplight[]>(['green']);
  const [skinId, setSkinId]       = useState<string>(
    () => localStorage.getItem('gopines-skin') ?? 'godash-may26',
  );
  const activeSkin = SKINS.find(s => s.id === skinId) ?? SKINS[0];
  const handleSkinSelect = (id: string) => {
    setSkinId(id);
    localStorage.setItem('gopines-skin', id);
  };
  const toggleQuality = (s: Stoplight) =>
    setQualities(qs => qs.includes(s) ? qs.filter(x => x !== s) : [...qs, s]);

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

  const dowFor = (dateStr: string) => new Date(dateStr + 'T12:00:00').getDay();
  const selectedDow = dowFor(dates[dateIdx].dateStr);
  const todayDow    = dowFor(today);

  let itineraries: Itinerary[] = [];
  if (selectedDay && ferryTrips.length) {
    const raw = direction === 'to-pines'
      ? buildToPines(selectedDay.outbound, ferryTrips, selectedDow, dates[dateIdx].dateStr)
      : buildToPenn(selectedDay.inbound, ferryTrips, selectedDow, dates[dateIdx].dateStr);
    itineraries = sort === 'latest' ? [...raw].reverse() : raw;
  }

  // Hero card always uses today's data, earliest-first — independent of date/sort.
  const todayDay = lirrData?.days?.find(d => d.date === today);
  const todayItineraries: Itinerary[] = (todayDay && ferryTrips.length)
    ? (direction === 'to-pines'
        ? buildToPines(todayDay.outbound, ferryTrips, todayDow, today)
        : buildToPenn(todayDay.inbound, ferryTrips, todayDow, today))
    : [];

  const fmtDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };
  const selectedDateLabel = fmtDateLabel(dates[dateIdx].dateStr);
  const todayLabel = fmtDateLabel(today);

  const C = activeSkin.palette;

  return (
    <ThemeContext.Provider value={C}>
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

      <DiscoHeader onMenuOpen={() => setPanel('menu')} />

      <div style={{ marginBottom: 8 }}>
        <DirectionToggle value={direction} onChange={v => { setDirection(v); setSort('earliest'); }} />
      </div>

      {!loading && !err && (
        <NextHero
          direction={direction}
          itineraries={todayItineraries.filter(i => i.stoplight !== 'red')}
          todayLabel={todayLabel}
          todayStr={today}
        />
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

      {!loading && (() => {
        const filtered = itineraries.filter(i => qualities.includes(i.stoplight));
        return (
          <>
            <FilterBar
              qualities={qualities}
              onToggleQ={toggleQuality}
              sort={sort}
              onSort={setSort}
            />
            <div>
              {filtered.length === 0 && !err ? (
                <div style={{ margin: '12px 18px', fontFamily: F.hand, color: '#7a736a', fontSize: 15 }}>
                  {qualities.length === 0
                    ? 'No quality filters selected — tap a chip above to see trips.'
                    : 'No trips match the selected quality filters.'}
                </div>
              ) : (
                filtered.map(it => (
                  <ItineraryRow key={it.id} it={it} direction={direction} dateLabel={selectedDateLabel} dateStr={dates[dateIdx].dateStr} />
                ))
              )}
            </div>
          </>
        );
      })()}

      <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 10px' }}>
        <Wave width={120} />
      </div>
      <div style={{ textAlign: 'center', fontFamily: F.hand, fontSize: 13, color: '#9b958c', paddingBottom: 24 }}>
        ferry data scraped daily · LIRR via open feed
      </div>

      <MenuPanel
        view={panel}
        setView={setPanel}
        ferryData={ferryData}
        ferryMock={ferryMock}
        homeStation={homeStation}
        setHomeStation={setHomeStation}
        skins={SKINS}
        activeSkinId={skinId}
        onSkinSelect={handleSkinSelect}
      />
    </div>
    </ThemeContext.Provider>
  );
}
