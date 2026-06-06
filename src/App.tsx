import { useState, useEffect, useContext, useRef, createContext, type CSSProperties, type ReactNode, type MouseEvent } from "react";
import * as Sentry from "@sentry/react";

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

const GRANDMAS_PALETTE: SkinPalette = {
  ...GODASH_PALETTE,
  ocean: '#7B1F0D', // warm DoorDash dark-red — dark enough for white text, light enough for ferry to read
  pink:  '#FFC8B6', // peachier so it pops against the warmer dark hero
};

// Bianchi — washed beach pastels. Tom Bianchi Polaroid hook.
const BIANCHI_PALETTE: SkinPalette = {
  sand:  '#FBF5EC', // warm cream, lighter & less yellow
  paper: '#FFFFFF', // unchanged
  ink:   '#3F3742', // washed plum-charcoal — never pure black
  ocean: '#B6CDDA', // washed sky blue — to-penn hero + ferry hull
  deep:  '#8FA8B6', // periwinkle haze — toggle home indicator
  coral: '#F2B8C2', // pastel dusty rose — primary accent + to-pines hero
  gold:  '#F2B8C2', // alias of coral
  pink:  '#F8D2D8', // pale baby pink — ferry pennant
  red:   '#C92033', // stoplight stays unchanged
  amber: '#F2BB05',
  green: '#00854D',
  mint:  '#DCE6E0', // washed seafoam — bus body
  yellow:'#F6E0A2', // sun-bleached butter — sun, sparkle
} as const;

type SkinCopy = {
  wordmark: string;
  heroToPines: string;
  heroToPenn: string;
  emptyToPines: string;
  emptyToPenn: string;
  stoplight: Record<'green' | 'amber' | 'red', string>;
  todayLabel: string;
  toggleToPines: string;
  toggleToPenn: string;
};

type Skin = {
  id: string;
  label: string;
  palette: SkinPalette;
  copy?: Partial<SkinCopy> & { stoplight?: Partial<SkinCopy['stoplight']> };
  fonts?: {
    disco?: string;
    discoStyle?: 'normal' | 'italic';
    discoWeight?: number;
    discoTracking?: number;
  };
  features?: {
    sponsorStrip?: boolean;
    dashBadge?: boolean;
    busRoofRack?: boolean;
    wordmarkSize?: number;
    wordmarkWrap?: boolean;
    // Bianchi-specific feature flags
    polaroidCameraMenu?: boolean;  // replace Sun with polaroid camera
    prideStripeSprites?: boolean;  // train/bus/ferry get a 6-stripe pride flag overlay
    polaroidCards?: boolean;       // wrap ItineraryRow in polaroid frame + caption strip
    discoBallWeekend?: boolean;    // Fri/Sat date pills get faceted disco-ball treatment
    heroTextInk?: boolean;         // hero text uses ink instead of white (pastel hero needs)
    customToggleIcons?: boolean;   // swap BeachSketch/SkylineSketch for richer Bianchi icons
  };
};

const FALLBACK_COPY: SkinCopy = {
  wordmark: 'GOPINES.GAY',
  heroToPines: 'NEXT TRAIN',
  heroToPenn:  'NEXT FERRY',
  emptyToPines: 'No more trains today — check back tomorrow!',
  emptyToPenn:  'No more ferries today — see you next time!',
  stoplight: { green: 'best', amber: 'risky', red: 'long' },
  todayLabel: 'today',
  toggleToPines: 'To the Pines',
  toggleToPenn:  'From the Pines',
};

function skinCopy(s: Skin): SkinCopy {
  return {
    ...FALLBACK_COPY,
    ...(s.copy ?? {}),
    stoplight: { ...FALLBACK_COPY.stoplight, ...(s.copy?.stoplight ?? {}) },
  };
}

const SKINS: Skin[] = [
  { id: 'godash-may26', label: "DoorDash - May'26", palette: GODASH_PALETTE },
  {
    id: 'grandmas',
    label: "May'26: DoorDash Grandmas",
    palette: GRANDMAS_PALETTE,
    copy: {
      wordmark: 'SPONSORED BY DOORDASH GRANDMAS OF 512 FISHERMANS',
      heroToPines: 'NEXT TRAIN DASH',
      heroToPenn:  'NEXT FERRY DASH',
      emptyToPines: "Kitchen's closed — check back tomorrow!",
      emptyToPenn:  'Last dash of the day — see you next time!',
      stoplight: { green: 'dashpass', amber: 'tight', red: 'slow lane' },
      todayLabel: 'dashing',
    },
    fonts: {
      disco: "'DM Sans', sans-serif",
      discoStyle: 'italic',
      discoWeight: 800,
      discoTracking: 1,
    },
    features: {
      sponsorStrip: true,
      dashBadge: true,
      busRoofRack: true,
      wordmarkSize: 16,
      wordmarkWrap: true,
    },
  },
  {
    id: 'bianchi',
    label: 'Bianchi',
    palette: BIANCHI_PALETTE,
    copy: {
      // wordmark stays GOPINES.GAY (default)
      heroToPines: 'NEXT TRAIN DEPARTS',
      heroToPenn:  'NEXT FERRY DEPARTS',
      // empty + stoplight + today all default-fine
      toggleToPenn: 'To the City',
    },
    features: {
      polaroidCameraMenu: true,
      prideStripeSprites: true,
      polaroidCards:      true,
      discoBallWeekend:   true,
      heroTextInk:        true,
      customToggleIcons:  true,
    },
  },
];

const ThemeContext = createContext<SkinPalette>(GODASH_PALETTE);
const useTheme = () => useContext(ThemeContext);

const SkinContext = createContext<Skin>(SKINS[0]);
const useSkin = () => useContext(SkinContext);

const F = {
  hand:   "'Patrick Hand', cursive",
  marker: "'Kalam', cursive",
  disco:  "'Monoton', sans-serif",
} as const;

function discoFont(skin: Skin): CSSProperties {
  return {
    fontFamily: skin.fonts?.disco ?? F.disco,
    fontStyle: skin.fonts?.discoStyle ?? 'normal',
    fontWeight: skin.fonts?.discoWeight ?? 400,
    letterSpacing: skin.fonts?.discoTracking ?? 1.5,
  };
}

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
  canceled?: boolean;
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
  extraStops?: boolean; // ▲ ferry stops at Cherry Grove en route
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

// Cached Sentry feedback dialog. createForm() is async and expensive; we
// only want one dialog instance, re-appended to the Shadow DOM each click.
// Cleared on submit so the next click gets a fresh form.
let _feedbackDialog: Awaited<ReturnType<NonNullable<ReturnType<typeof Sentry.getFeedback>>["createForm"]>> | null = null;

async function reportBug(opts: { type: string; title?: string; details?: Record<string, unknown> }) {
  try {
    Sentry.setTag('bug_context', opts.type);
    if (opts.title) Sentry.setTag('bug_title', opts.title.slice(0, 200));
    if (opts.details) Sentry.setContext('bug_details', opts.details);

    const feedback = Sentry.getFeedback();
    if (!feedback) {
      console.warn('Sentry feedback integration not available — check VITE_SENTRY_DSN and Sentry.init integrations.');
      return;
    }
    if (!_feedbackDialog) {
      _feedbackDialog = await feedback.createForm({
        onFormSubmitted: () => {
          _feedbackDialog?.removeFromDom();
          _feedbackDialog = null;
        },
      });
    }
    _feedbackDialog.appendToDom();
    _feedbackDialog.open();
  } catch (err) {
    console.error('Failed to open bug-report dialog:', err);
  }
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
//   • long (red)   = 3h+ door-to-door, OR a comfortable-but-slower trip that
//                    catches the same ferry as a more efficient "best" trip
//   • risky (amber)= short trip but tight (<20 min) Sayville transfer
//   • best (green) = the single most efficient (lowest total) comfortable
//                    (≥20 min Sayville layover) trip for each ferry departure
const COMFORT_LAYOVER_MIN = 20;
const AVOID_TOTAL_MIN = 180;
function sl(totalMin: number, layoverMin: number): Stoplight {
  if (totalMin >= AVOID_TOTAL_MIN) return 'red';
  return layoverMin >= COMFORT_LAYOVER_MIN ? 'green' : 'amber';
}

// "Best" must mean best: for each ferry departure only the single most efficient
// (lowest total door-to-door) comfortable trip keeps "best" (green). Other
// comfortable trips that catch the same ferry are longer than best but aren't
// risky, so they're filed under "long" (red). Risky/long trips are left as-is.
function keepBestPerFerry(items: Itinerary[], ferryKey: (it: Itinerary) => string): void {
  const groups = new Map<string, Itinerary[]>();
  for (const it of items) {
    const k = ferryKey(it);
    const g = groups.get(k);
    if (g) g.push(it); else groups.set(k, [it]);
  }
  for (const group of groups.values()) {
    const greens = group.filter(it => it.stoplight === 'green');
    if (greens.length <= 1) continue;
    let best = greens[0];
    for (const it of greens) if (it.total < best.total) best = it;
    for (const it of greens) if (it !== best) it.stoplight = 'red';
  }
}

function slInfo(s: Stoplight, labels: SkinCopy['stoplight'] = FALLBACK_COPY.stoplight) {
  const bg = s === 'green' ? C.green : s === 'amber' ? C.amber : C.red;
  return { bg, label: labels[s] };
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
    .map(f => ({ time: f.departureTime.slice(0, 5), extraStops: !!f.extraStops }))
    .sort((a, b) => a.time.localeCompare(b.time));
  let id = 0;
  const result: Itinerary[] = [];
  for (const j of outbound) {
    if (j.canceled) continue;
    const sayArr = j.arrive.slice(0, 5);
    const thresh = toMin(sayArr) + WALK_MIN;
    const ferryTrip = pines.find(f => toMin(f.time) >= thresh);
    if (!ferryTrip) continue;
    const ferry = ferryTrip.time;
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
      { kind: 'ferry', time: fmt(ferry),  fromTo: 'Sayville → Pines', extraStops: ferryTrip.extraStops },
    ];
    result.push({
      id: ++id,
      depart: fmt(j.depart),    departRaw: j.depart.slice(0, 5),
      arrive: fmt(pinesArrRaw), arriveRaw: pinesArrRaw,
      layover, total, stoplight: sl(total, layover),
      segments,
    });
  }
  keepBestPerFerry(result, it => it.arriveRaw);
  return result;
}

function buildToPenn(inbound: Journey[], ferries: FerryTrip[], dow: number, dateStr?: string): Itinerary[] {
  const dayFerries = ferriesForDay(ferries, dow, dateStr);
  const hasPenn = dayFerries.some(f => f.direction === 'pines_to_sayville');
  const pennDeps = dayFerries
    .filter(f => hasPenn ? f.direction === 'pines_to_sayville' : f.direction === 'unknown')
    .map(f => ({ time: f.departureTime.slice(0, 5), extraStops: !!f.extraStops }))
    .sort((a, b) => a.time.localeCompare(b.time));
  const trains = [...inbound].filter(j => !j.canceled).sort((a, b) => toMin(a.depart.slice(0, 5)) - toMin(b.depart.slice(0, 5)));
  let id = 0;
  const result: Itinerary[] = [];
  for (const ferryTrip of pennDeps) {
    const ferryDep = ferryTrip.time;
    const sayArrRaw = addMin(ferryDep, FERRY_MIN);
    const thresh = toMin(sayArrRaw) + WALK_MIN;
    const train = trains.find(j => toMin(j.depart.slice(0, 5)) >= thresh);
    if (!train) continue;
    const layover = toMin(train.depart.slice(0, 5)) - toMin(sayArrRaw);
    if (layover > MAX_LAYOVER_MIN) continue;
    const total = toMin(train.arrive.slice(0, 5)) - toMin(ferryDep);
    if (total < 60 || total > 240) continue;
    const segments: Segment[] = [
      { kind: 'ferry', time: fmt(ferryDep),  fromTo: 'Pines → Sayville', extraStops: ferryTrip.extraStops },
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
  keepBestPerFerry(result, it => it.departRaw);
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

// Pride flag stripe overlay used by Bianchi sprites. Saturated, NOT pastel —
// the stripes are the one place in the skin that breaks the washed palette.
// Six stripes evenly divided across (y..y+h). Final outline rect stays on top
// so the rainbow reads as inside a window/flag frame, not a raw block.
const PRIDE_STRIPES = ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004DFF', '#750787'] as const;
function PrideStripes({ x, y, w, h, rx = 1.5, inkStroke }: {
  x: number; y: number; w: number; h: number; rx?: number; inkStroke: string;
}) {
  const stripeH = h / 6;
  return (
    <>
      {PRIDE_STRIPES.map((color, i) => (
        <rect key={i} x={x} y={y + i * stripeH} width={w} height={stripeH} fill={color} />
      ))}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke={inkStroke} strokeWidth="1.2" />
    </>
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

function Sun({ size = 60, style = {}, showMenu = false }: { size?: number; style?: CSSProperties; showMenu?: boolean }) {
  const C = useTheme();
  const skin = useSkin();
  // Bianchi: replace the sun entirely with a polaroid camera (SX-70-ish), with a
  // single-rect flash bulb that pulses to yellow every 7.5s. Same size + click area.
  if (skin.features?.polaroidCameraMenu) {
    return (
      <svg width={size} height={size * (48 / 64)} viewBox="0 0 64 48" style={style}>
        <g filter="url(#wobble)">
          {/* viewfinder hood on top */}
          <path d="M14 14 L14 8 Q14 6 16 6 L48 6 Q50 6 50 8 L50 14 Z"
            fill={C.paper} stroke={C.ink} strokeWidth="1.4" />
          <rect x="40" y="8" width="7" height="4" rx="0.5" fill={C.ink} />
          <line x1="17" y1="11" x2="33" y2="11" stroke={C.ink} strokeWidth="0.7" />
          {/* camera body */}
          <rect x="6" y="14" width="52" height="28" rx="3"
            fill={C.paper} stroke={C.ink} strokeWidth="1.6" />
          {/* lens */}
          <circle cx="22" cy="28" r="8" fill={C.paper} stroke={C.ink} strokeWidth="1.4" />
          <circle cx="22" cy="28" r="5.4" fill={C.ink} />
          <circle cx="20.4" cy="26.6" r="1.4" fill={C.paper} opacity="0.85" />
          {/* flash bulb — pulses */}
          <rect className="cam-bulb" x="44" y="18" width="8" height="5" rx="0.8"
            fill={C.paper} stroke={C.ink} strokeWidth="1" />
          <line x1="44" y1="20.5" x2="52" y2="20.5" stroke={C.ink} strokeWidth="0.4" />
          {/* shutter button */}
          <rect x="36" y="16" width="4" height="2.6" rx="0.6"
            fill={C.coral} stroke={C.ink} strokeWidth="0.8" />
        </g>
      </svg>
    );
  }
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
        {showMenu && <>
          <line x1="38" y1="44" x2="62" y2="44" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round"
            style={{ animation: 'sun-menu-pulse 2.4s ease-in-out infinite', animationDelay: '0s' }} />
          <line x1="38" y1="50" x2="62" y2="50" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round"
            style={{ animation: 'sun-menu-pulse 2.4s ease-in-out infinite', animationDelay: '0.2s' }} />
          <line x1="38" y1="56" x2="62" y2="56" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round"
            style={{ animation: 'sun-menu-pulse 2.4s ease-in-out infinite', animationDelay: '0.4s' }} />
        </>}
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
  const skin = useSkin();
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
        {/* Middle window: pride flag for Bianchi, paper otherwise */}
        {skin.features?.prideStripeSprites ? (
          <PrideStripes x={42} y={26} w={10} h={10} inkStroke={C.ink} />
        ) : (
          <rect x="42" y="26" width="10" height="10" rx="1.5" fill={C.paper} stroke={C.ink} strokeWidth="1.2" />
        )}
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
  const skin = useSkin();
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 100 70" style={style}>
      <g filter="url(#wobble)">
        <path d="M8 44 L92 44 L84 58 L16 58 Z" fill={C.ocean} stroke={C.ink} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="22" y="28" width="56" height="16" fill={C.paper} stroke={C.ink} strokeWidth="1.6" />
        <rect x="28" y="32" width="8" height="8" fill={C.ocean} stroke={C.ink} strokeWidth="1" />
        <rect x="40" y="32" width="8" height="8" fill={C.ocean} stroke={C.ink} strokeWidth="1" />
        <rect x="52" y="32" width="8" height="8" fill={C.ocean} stroke={C.ink} strokeWidth="1" />
        <rect x="64" y="32" width="8" height="8" fill={C.ocean} stroke={C.ink} strokeWidth="1" />
        {/* Cabin-top flag: pride for Bianchi, coral pennant otherwise */}
        {skin.features?.prideStripeSprites ? (
          <PrideStripes x={42} y={14} w={22} h={14} rx={0} inkStroke={C.ink} />
        ) : (
          <rect x="42" y="14" width="22" height="14" fill={C.coral} stroke={C.ink} strokeWidth="1.6" />
        )}
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

function DashBadge({ size = 14 }: { size?: number }) {
  const C = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <g filter="url(#wobble)">
        <text x="2" y="11"
              fontFamily="'Patrick Hand', cursive"
              fontStyle="italic" fontWeight="700"
              fontSize="12" fill={C.ink}>D</text>
      </g>
    </svg>
  );
}

function Bus({ size = 44, style = {} }: { size?: number; style?: CSSProperties }) {
  const C = useTheme();
  const skin = useSkin();
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 100 62" style={style}>
      <g filter="url(#wobble)">
        {/* body */}
        <rect x="8" y="18" width="80" height="28" rx="5" fill={C.mint} stroke={C.ink} strokeWidth="1.6" />
        {/* roof rack — Grandmas only (the "dash bag" gag) */}
        {skin.features?.busRoofRack && (
          <rect x="20" y="14" width="56" height="4" rx="1.2" fill={C.coral} stroke={C.ink} strokeWidth="1" />
        )}
        {/* roof line */}
        <line x1="10" y1="24" x2="86" y2="24" stroke={C.ink} strokeWidth="1.2" />
        {/* windows — third window is pride flag for Bianchi */}
        <rect x="14" y="26" width="12" height="10" rx="1.2" fill={C.paper} stroke={C.ink} strokeWidth="1" />
        <rect x="30" y="26" width="12" height="10" rx="1.2" fill={C.paper} stroke={C.ink} strokeWidth="1" />
        {skin.features?.prideStripeSprites ? (
          <PrideStripes x={46} y={26} w={12} h={10} inkStroke={C.ink} />
        ) : (
          <rect x="46" y="26" width="12" height="10" rx="1.2" fill={C.paper} stroke={C.ink} strokeWidth="1" />
        )}
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

// Bianchi-only: canonical pines icon from the design handoff. Sun with rays in
// upper-right, three stylized pine trees with brown trunks, ocean wave below.
function BianchiPinesIcon({ size = 28 }: { size?: number }) {
  const C = useTheme();
  const PINE_TRUNK = '#7a3a1a';
  return (
    <svg width={size} height={size * (32 / 44)} viewBox="0 0 44 32">
      <g filter="url(#wobble)">
        {/* sun + 5 rays, upper-right */}
        <circle cx="36" cy="6" r="3" fill={C.yellow} stroke={C.ink} strokeWidth="1" />
        <line x1="36"   y1="1"   x2="36"   y2="2.5" stroke={C.ink} strokeWidth="0.9" strokeLinecap="round" />
        <line x1="40.5" y1="6"   x2="42"   y2="6"   stroke={C.ink} strokeWidth="0.9" strokeLinecap="round" />
        <line x1="39.4" y1="2.6" x2="40.5" y2="1.5" stroke={C.ink} strokeWidth="0.9" strokeLinecap="round" />
        <line x1="32.6" y1="2.6" x2="31.5" y2="1.5" stroke={C.ink} strokeWidth="0.9" strokeLinecap="round" />
        <line x1="32"   y1="6"   x2="30.5" y2="6"   stroke={C.ink} strokeWidth="0.9" strokeLinecap="round" />
        {/* middle pine */}
        <path d="M16 24 L16 16 L11 16 L16 9 L13 9 L16 4 L19 9 L16 9 L21 16 L16 16 L16 24 Z"
              fill={C.green} stroke={C.ink} strokeWidth="1.2" strokeLinejoin="round" />
        <rect x="15" y="22" width="2" height="3" fill={PINE_TRUNK} stroke={C.ink} strokeWidth="0.8" />
        {/* left pine */}
        <path d="M5 25 L5 19 L1.5 19 L5 14 L3 14 L5 10 L7 14 L5 14 L8.5 19 L5 19 L5 25 Z"
              fill={C.green} stroke={C.ink} strokeWidth="1.1" strokeLinejoin="round" />
        <rect x="4.3" y="23.5" width="1.4" height="2.2" fill={PINE_TRUNK} stroke={C.ink} strokeWidth="0.7" />
        {/* right pine */}
        <path d="M27 26 L27 21 L24 21 L27 16 L25.5 16 L27 12 L28.5 16 L27 16 L30 21 L27 21 L27 26 Z"
              fill={C.green} stroke={C.ink} strokeWidth="1.1" strokeLinejoin="round" />
        <rect x="26.4" y="24.7" width="1.2" height="2" fill={PINE_TRUNK} stroke={C.ink} strokeWidth="0.7" />
        {/* horizon + wavy ocean */}
        <line x1="0" y1="26" x2="44" y2="26" stroke={C.ink} strokeWidth="1.2" />
        <path d="M0 30 q 3 -1.5 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0"
              stroke={C.ocean} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// Bianchi-only: canonical skyline icon. Empire State (cream face, stepped
// setbacks, antenna) + Lady Liberty rotated -12° on the left in patina green.
function BianchiSkylineIcon({ size = 28 }: { size?: number }) {
  const C = useTheme();
  const LIBERTY = '#9FC8B5';
  return (
    <svg width={size} height={size * (30 / 38)} viewBox="0 0 38 30">
      <g filter="url(#wobble)" stroke={C.ink} strokeLinejoin="round" strokeLinecap="round">
        {/* Empire State setbacks */}
        <g fill={C.paper} strokeWidth="1.1">
          <rect x="17" y="26" width="14" height="2" />
          <rect x="18.5" y="14" width="11" height="12" />
          <rect x="20" y="9" width="8" height="5" />
          <rect x="21.5" y="5" width="5" height="4" />
        </g>
        {/* antenna */}
        <g stroke={C.ink} strokeWidth="0.9" fill={C.ink}>
          <line x1="24" y1="5" x2="24" y2="2.2" strokeWidth="1.1" />
          <circle cx="24" cy="2" r="0.6" />
        </g>
        {/* faint window rows */}
        <g stroke={C.deep} strokeWidth="0.5" opacity="0.85">
          <line x1="19.5" y1="16.5" x2="28.5" y2="16.5" />
          <line x1="19.5" y1="19"   x2="28.5" y2="19" />
          <line x1="19.5" y1="21.5" x2="28.5" y2="21.5" />
          <line x1="19.5" y1="24"   x2="28.5" y2="24" />
          <line x1="20.5" y1="10.5" x2="27.5" y2="10.5" />
          <line x1="20.5" y1="12.5" x2="27.5" y2="12.5" />
        </g>
        {/* vertical mullions */}
        <g stroke={C.ink} strokeWidth="0.5" opacity="0.7">
          <line x1="21.5" y1="14" x2="21.5" y2="26" />
          <line x1="24"   y1="14" x2="24"   y2="26" />
          <line x1="26.5" y1="14" x2="26.5" y2="26" />
        </g>
        {/* Lady Liberty, rotated -12° */}
        <g transform="rotate(-12 11 18)">
          <rect x="6" y="22" width="9" height="6" fill={C.paper} strokeWidth="1.1" />
          <line x1="6" y1="24.5" x2="15" y2="24.5" strokeWidth="0.5" opacity="0.6" />
          <path d="M 7.5 22 L 8.6 14.5 L 9.4 12 L 11.6 12 L 12.4 14.5 L 13.5 22 Z" fill={LIBERTY} strokeWidth="1.1" />
          <g stroke="#5e8a76" strokeWidth="0.4" fill="none" opacity="0.7">
            <path d="M 9 16 L 9.4 21.6" />
            <path d="M 10.5 14.5 L 10.5 21.8" />
            <path d="M 12 16 L 11.6 21.6" />
          </g>
          <rect x="6.4" y="15.4" width="2.6" height="3.4" fill={LIBERTY} strokeWidth="0.9" />
          <circle cx="10.5" cy="10.5" r="1.4" fill={LIBERTY} strokeWidth="1" />
          {/* crown spikes */}
          <g strokeWidth="0.8" fill="none">
            <line x1="10.5" y1="9.2" x2="10.5" y2="7.4" />
            <line x1="10.5" y1="9.2" x2="9.4"  y2="7.8" />
            <line x1="10.5" y1="9.2" x2="11.6" y2="7.8" />
            <line x1="10.5" y1="9.2" x2="8.6"  y2="8.4" />
            <line x1="10.5" y1="9.2" x2="12.4" y2="8.4" />
            <line x1="10.5" y1="9.2" x2="7.8"  y2="9.2" />
            <line x1="10.5" y1="9.2" x2="13.2" y2="9.2" />
          </g>
          {/* torch arm + flame + tablet */}
          <path d="M 11.6 12.4 L 13.4 9.6 L 14.4 7.6" stroke={LIBERTY} strokeWidth="1.2" fill="none" />
          <path d="M 14 7.8 L 14.9 5.6 L 15.7 7.4 Z" fill={C.yellow} strokeWidth="0.8" />
          <line x1="14.9" y1="5.6" x2="15.2" y2="4.2" strokeWidth="0.6" />
          <rect x="14.1" y="7.4" width="1.6" height="1.1" fill="#9a6a3e" strokeWidth="0.5" />
        </g>
        {/* horizon + faint water */}
        <line x1="0" y1="28" x2="38" y2="28" strokeWidth="1.1" fill="none" />
        <path d="M 0 29.4 Q 4 28.8, 8 29.4 T 16 29.4 T 24 29.4 T 32 29.4 T 38 29.4"
              stroke={C.ocean} strokeWidth="0.9" fill="none" />
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
  it, direction, dateStr, dateLabel, originLabel, style = {},
}: {
  it: Itinerary;
  direction: 'to-pines' | 'to-penn';
  dateStr: string;
  dateLabel: string;
  originLabel: string;
  style?: CSSProperties;
}) {
  const C = useTheme();
  const [added, setAdded] = useState(false);

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    const toPines = direction === 'to-pines';
    const summary = toPines ? 'Pines bound' : `Heading to ${originLabel}`;
    const firstSeg = it.segments[0];
    const location = firstSeg ? firstSeg.fromTo.split(' → ')[0] : (toPines ? originLabel : 'Pines Ferry');
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

function BugButton({ it, direction, dateLabel, dateStr }: {
  it: Itinerary;
  direction: 'to-pines' | 'to-penn';
  dateLabel: string;
  dateStr: string;
}) {
  const C = useTheme();

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    const dirLabel = direction === 'to-pines' ? 'To the Pines' : 'From the Pines';
    const segments = it.segments.map(s => ({
      time: s.time,
      fromTo: s.fromTo,
      name: s.name,
    }));
    reportBug({
      type: 'trip',
      title: `[Trip Error] ${dirLabel} ${dateLabel} ${it.depart}→${it.arrive}`,
      details: {
        direction: dirLabel,
        date: dateLabel,
        dateStr,
        depart: it.depart,
        arrive: it.arrive,
        stoplight: it.stoplight,
        segments,
      },
    });
    track('report_trip_error', {
      direction,
      trip_date: dateStr,
      depart_time: it.departRaw,
      stoplight: it.stoplight,
    });
  };

  return (
    <button onClick={onClick} aria-label="report trip error" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      border: '1.2px solid ' + C.ink,
      background: 'rgba(255,255,255,0.7)', color: C.ink, cursor: 'pointer',
      borderRadius: 999, padding: '3px 9px',
      fontFamily: F.marker, fontSize: 11, letterSpacing: 0.6,
      boxShadow: '1px 1.5px 0 ' + C.ink,
    }}>
      <svg width="11" height="11" viewBox="0 0 14 14">
        <g stroke={C.ink} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#wobble)">
          <ellipse cx="7" cy="8.5" rx="3" ry="3.8" />
          <circle cx="7" cy="3.8" r="1.6" />
          {/* legs */}
          <line x1="4" y1="7" x2="1.5" y2="5.5" />
          <line x1="4" y1="8.5" x2="1.5" y2="8.5" />
          <line x1="4" y1="10" x2="1.5" y2="11.5" />
          <line x1="10" y1="7" x2="12.5" y2="5.5" />
          <line x1="10" y1="8.5" x2="12.5" y2="8.5" />
          <line x1="10" y1="10" x2="12.5" y2="11.5" />
          {/* antennae */}
          <line x1="6" y1="2.4" x2="4.5" y2="1" />
          <line x1="8" y1="2.4" x2="9.5" y2="1" />
        </g>
      </svg>
      BUG
    </button>
  );
}

function DirectionToggle({ value, onChange }: {
  value: 'to-pines' | 'to-penn'; onChange: (v: 'to-pines' | 'to-penn') => void;
}) {
  const C = useTheme();
  const skin = useSkin();
  const copy = skinCopy(skin);
  const isPines = value === 'to-pines';
  const onColor = skin.features?.heroTextInk ? C.ink : '#fff';
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
                color: on ? onColor : '#9b958c', letterSpacing: 0.4,
                transition: 'color .2s ease',
              }}>
                <span style={{ filter: on ? 'none' : 'grayscale(0.4) opacity(0.8)', transition: 'filter .2s ease' }}>
                  {k === 'to-pines'
                    ? (skin.features?.customToggleIcons ? <BianchiPinesIcon size={26} /> : <BeachSketch size={26} />)
                    : (skin.features?.customToggleIcons ? <BianchiSkylineIcon size={26} /> : <SkylineSketch size={26} />)}
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  {k === 'to-pines' ? copy.toggleToPines : copy.toggleToPenn}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SketchBox>
  );
}

function NextHero({ direction, itineraries, todayLabel, todayStr, originLabel }: {
  direction: 'to-pines' | 'to-penn';
  itineraries: Itinerary[];   // always today's, earliest-first
  todayLabel: string;          // formatted, e.g. "Sat May 9, 2026"
  todayStr: string;            // YYYY-MM-DD for analytics payloads
  originLabel: string;
}) {
  const C = useTheme();
  const skin = useSkin();
  const copy = skinCopy(skin);
  const toPines = direction === 'to-pines';
  const nowM = toMin(nowNY());
  const next = itineraries.find(it => toMin(it.departRaw) > nowM) ?? itineraries[0];
  // Pastel hero (Bianchi) needs ink text; saturated hero (default/Grandmas) needs white.
  const heroFg = skin.features?.heroTextInk ? C.ink : '#FFFFFF';

  if (!next) {
    return (
      <div style={{ margin: '2px 18px 12px' }}>
        <SketchBox color={C.ink} fill={toPines ? C.gold : C.ocean} radius={20} sw={1.8} pad={14}>
          <div style={{ fontFamily: F.hand, color: heroFg, fontSize: 15 }}>
            {toPines ? copy.emptyToPines : copy.emptyToPenn}
          </div>
        </SketchBox>
      </div>
    );
  }

  const diffMin = toMin(next.departRaw) - nowM;
  const showCountdown = diffMin > 0 && diffMin < 12 * 60;
  const title = toPines ? copy.heroToPines : copy.heroToPenn;
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
  const slBg    = next.stoplight === 'green' ? C.green : next.stoplight === 'amber' ? C.amber : C.red;
  const slLabel = copy.stoplight[next.stoplight];

  return (
    <div style={{ margin: '2px 18px 12px', position: 'relative' }}>
      <SketchBox color={C.ink} fill={toPines ? C.gold : C.ocean} radius={20} sw={1.8} pad={0}>
        <div style={{ padding: '12px 14px 14px', position: 'relative', overflow: 'hidden' }}>

          {/* Top row: title + countdown on the left, stoplight chip on the right */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ fontFamily: F.hand, fontSize: 15, color: heroFg, letterSpacing: 0.3, lineHeight: 1.2, flex: 1, minWidth: 0 }}>
              {title}
              {showCountdown && (
                <span style={{ fontFamily: F.marker, color: heroFg }}>
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
              {skin.features?.dashBadge && <DashBadge size={10} />}
              <span style={{
                width: 8, height: 8, borderRadius: 999, background: slBg,
                border: '1px solid ' + C.ink, display: 'inline-block',
              }} />
              <span style={{ fontFamily: F.marker, fontSize: 11, color: C.ink, letterSpacing: 0.4 }}>{slLabel}</span>
              <span style={{ fontFamily: F.hand, fontSize: 11, color: '#5a544c' }}>· {hmStr(next.total)}</span>
            </div>
          </div>

          {/* Big disco time */}
          <div style={{ ...discoFont(skin), fontSize: 34, color: heroFg, lineHeight: 1, marginTop: 6 }}>
            {next.depart.toUpperCase()}
          </div>

          {/* Subtitle (route summary) */}
          <div style={{ fontFamily: F.hand, fontSize: 14, marginTop: 4, color: heroFg, lineHeight: 1.25, maxWidth: 'calc(100% - 80px)' }}>
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
    const tail = s.name ? ` (${s.name})` : s.extraStops ? ' ▲' : '';
    return `• ${s.time} — ${s.fromTo}${tail}`;
  }).join('\n');
  return `${dateLabel}\n${dirLabel}\n\n${bullets}\n\ngopines.gay`;
}

function ItineraryRow({ it, direction, dateLabel, dateStr, originLabel }: {
  it: Itinerary;
  direction: 'to-pines' | 'to-penn';
  dateLabel: string;
  dateStr: string;
  originLabel: string;
}) {
  const C = useTheme();
  const skin = useSkin();
  const { bg, label } = slInfo(it.stoplight, skinCopy(skin).stoplight);
  const shareText = buildShareText(direction, dateLabel, it.segments);
  const isPolaroid = !!skin.features?.polaroidCards;

  // Header + timeline; this is the "photo region" content for polaroid, or the
  // top-of-card content for the classic SketchBox.
  const photoContent = (
    <>
      {/* Header: times + stoplight + duration */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontFamily: F.marker, fontSize: 20, color: C.ink, letterSpacing: 0.4 }}>
            {it.depart}
            <span style={{ fontFamily: F.hand, fontSize: 16, margin: '0 6px', color: '#7a736a' }}>—</span>
            {it.arrive}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {skin.features?.dashBadge && <DashBadge size={10} />}
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
                  {seg.extraStops && (
                    <div style={{ fontFamily: F.hand, fontSize: 12, color: '#9b958c', marginTop: 1 }}>
                      ▲ stops at Cherry Grove
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

    </>
  );

  // Action triplet: bug (left) + calendar + share (right). Shared between
  // classic action-row and polaroid caption-strip layouts.
  const bugBtn = <BugButton it={it} direction={direction} dateLabel={dateLabel} dateStr={dateStr} />;
  const calBtn = <CalendarInviteButton it={it} direction={direction} dateStr={dateStr} dateLabel={dateLabel} originLabel={originLabel} />;
  const shareBtn = (
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
  );

  if (isPolaroid) {
    // Polaroid layout: outer paper frame (radius 6, ~square), inner sand "photo"
    // (radius 4), then a 56px caption strip below carrying the actions + date.
    const captionDate = dateLabel.replace(/,\s*\d{4}$/, '').replace(/^([A-Za-z]+),\s*/, '$1 ');
    return (
      <div style={{ margin: '0 18px 12px', position: 'relative' }}>
        <SketchBox color={C.ink} fill={C.paper} radius={6} sw={1.6} pad={0}>
          <div style={{ padding: '12px 12px 0 12px' }}>
            <SketchBox color={C.ink} fill={C.sand} radius={4} sw={1.4} pad={0}>
              <div style={{ padding: '10px 14px 14px' }}>
                {photoContent}
              </div>
            </SketchBox>
          </div>
          {/* Caption strip: bug (left) · date (center, Kalam 13) · ADD/SHARE (right) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px 12px 10px', minHeight: 32,
          }}>
            <div style={{ flex: '0 0 auto' }}>{bugBtn}</div>
            <div style={{
              flex: 1, minWidth: 0,
              fontFamily: F.marker, fontSize: 13, color: C.ink,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              textAlign: 'center', letterSpacing: 0.2,
            }}>
              {captionDate}
            </div>
            <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
              {calBtn}
              {shareBtn}
            </div>
          </div>
        </SketchBox>
      </div>
    );
  }

  // Classic layout (godash + grandmas).
  return (
    <SketchBox color={C.ink} fill={C.paper} radius={18} sw={1.6} pad={0}
      style={{ margin: '0 18px 12px', position: 'relative' }}>
      <div style={{ padding: '10px 14px 14px' }}>
        {photoContent}
        {/* Action row: bug report + calendar invite + share */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          {bugBtn}
          <div style={{ display: 'flex', gap: 6 }}>
            {calBtn}
            {shareBtn}
          </div>
        </div>
      </div>
    </SketchBox>
  );
}

// Faceted disco-ball facets for Bianchi weekend pills. 8 latitude rows; row width
// + tick count scale by cos(phi). Stroke 0.4, opacity 0.55, behind the pill.
function DiscoFacets({ inkStroke }: { inkStroke: string }) {
  const W = 52, H = 44, cx = W / 2, cy = H / 2;
  const rx = W / 2 - 2.5, ry = H / 2 - 2.5;
  const rows = 8;
  const facets: React.ReactNode[] = [];
  for (let i = 0; i < rows; i++) {
    const phi  = ((i + 0.5) / rows) * Math.PI - Math.PI / 2;
    const cosP = Math.cos(phi);
    const y    = cy + ry * Math.sin(phi);
    const rowW = (W - 5) * cosP;
    const arch = 0.6 * cosP;
    const x0   = cx - rowW / 2;
    const x1   = cx + rowW / 2;
    const rowH = (ry * Math.PI) / rows;
    // latitude arched line
    facets.push(
      <path key={`lat-${i}`}
        d={`M ${x0} ${y} Q ${cx} ${y - arch} ${x1} ${y}`}
        stroke={inkStroke} strokeWidth="0.4" fill="none" />
    );
    // vertical tile-edge ticks
    const ticks = Math.max(3, Math.round(11 * cosP));
    for (let t = 0; t < ticks; t++) {
      const xt = x0 + (rowW * (t + 0.5)) / ticks;
      const yMid = y - arch * Math.sin((Math.PI * (t + 0.5)) / ticks);
      const tH = rowH * 0.78;
      facets.push(
        <line key={`tick-${i}-${t}`}
          x1={xt} y1={yMid - tH / 2} x2={xt} y2={yMid + tH / 2}
          stroke={inkStroke} strokeWidth="0.4" />
      );
    }
  }
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, opacity: 0.55, pointerEvents: 'none', borderRadius: 'inherit', overflow: 'hidden' }}
      filter="url(#wobble)">
      {facets}
    </svg>
  );
}

// Hanging rail + string + clasp above a disco pill.
function DiscoString({ inkStroke, paper }: { inkStroke: string; paper: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14"
      style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
      <line x1="2"  y1="1.5" x2="12" y2="1.5" stroke={inkStroke} strokeWidth="0.9" strokeLinecap="round" />
      <line x1="7"  y1="1.5" x2="7"  y2="11"  stroke={inkStroke} strokeWidth="0.7" />
      <rect x="5.6" y="10.5" width="2.8" height="1.6" fill={paper} stroke={inkStroke} strokeWidth="0.5" />
    </svg>
  );
}

function DatePickerStrip({ value, onChange, dates }: {
  value: number;
  onChange: (i: number) => void;
  dates: ReturnType<typeof rollingDates>;
}) {
  const C = useTheme();
  const skin = useSkin();
  const todayLabel = skinCopy(skin).todayLabel;
  const isDisco = !!skin.features?.discoBallWeekend;
  const inkOnActive = !!skin.features?.heroTextInk; // pastel coral needs ink, not white

  // Per-pill twinkle scheduler — each weekend pill blinks once on its own
  // random 4–8s cadence with a random 0–3s initial offset, so pills never
  // lockstep. .go class fires the bianchi-twinkle keyframe once via index.html.
  const twinkleRefs = useRef<Array<HTMLSpanElement | null>>([]);
  useEffect(() => {
    if (!isDisco) return;
    const timers: number[] = [];
    const fire = (el: HTMLSpanElement) => {
      el.classList.remove('go');
      void el.offsetWidth; // force reflow so a re-add restarts the animation
      el.classList.add('go');
    };
    const schedule = (el: HTMLSpanElement) => {
      const delay = 4000 + Math.random() * 4000;
      const t = window.setTimeout(() => {
        fire(el);
        schedule(el);
      }, delay);
      timers.push(t);
    };
    for (const el of twinkleRefs.current) {
      if (!el) continue;
      const initial = window.setTimeout(() => schedule(el), Math.random() * 3000);
      timers.push(initial);
    }
    return () => { for (const t of timers) window.clearTimeout(t); };
  }, [isDisco, dates.length]);

  return (
    <div style={{ margin: isDisco ? '18px 0 10px' : '6px 0 10px' }}>
      <div style={{ overflowX: 'auto', padding: '4px 18px 8px' }}>
        <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
          {dates.map(d => {
            const on = value === d.i;
            const isDiscoPill = isDisco && d.weekend;
            return (
              <button key={d.i} onClick={() => onChange(d.i)} style={{
                flex: '0 0 auto', width: 52, padding: '8px 0',
                border: '1.6px solid ' + C.ink, borderRadius: 999,
                background: on ? C.coral : (d.weekend ? C.paper : '#fff'),
                color: on ? (inkOnActive ? C.ink : '#fff') : C.ink,
                boxShadow: on ? '2px 3px 0 ' + C.ink : '1.5px 2px 0 ' + C.ink,
                cursor: 'pointer', position: 'relative',
                transform: on ? 'translate(-1px,-1px)' : 'none',
                overflow: isDiscoPill ? 'visible' : 'hidden',
              }}>
                {isDiscoPill && <DiscoFacets inkStroke={C.ink} />}
                {isDiscoPill && <DiscoString inkStroke={C.ink} paper={C.paper} />}
                {isDiscoPill && (
                  <span
                    ref={el => { twinkleRefs.current[d.i] = el; }}
                    className="bianchi-twinkle"
                    style={{
                      position: 'absolute',
                      top: `${20 + ((d.i * 13) % 14)}%`,
                      left: `${28 + ((d.i * 23) % 44)}%`,
                      width: 5, height: 5, borderRadius: 999,
                      background: '#fff', boxShadow: '0 0 5px 1.5px #fff',
                      pointerEvents: 'none',
                      opacity: 0,
                    }} />
                )}
                <div style={{ fontFamily: F.hand, fontSize: 13, opacity: 0.8, position: 'relative', zIndex: 1 }}>{d.today ? todayLabel : d.dow}</div>
                <div style={{ fontFamily: F.marker, fontSize: 18, lineHeight: 1, letterSpacing: 0.5, position: 'relative', zIndex: 1 }}>{d.dom}</div>
                {d.weekend && !on && !isDiscoPill && (
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
  const QUALITY_LABEL: Record<Stoplight, string> = skinCopy(useSkin()).stoplight;
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
  const skin = useSkin();
  const copy = skinCopy(skin);
  return (
    <>
      {skin.features?.sponsorStrip && (
        <div style={{
          borderTop: '1px solid ' + C.ink,
          borderBottom: '1px solid ' + C.ink,
          padding: '6px 18px',
          fontFamily: F.hand,
          fontSize: 12,
          color: C.ink,
          background: C.sand,
          lineHeight: 1.2,
        }}>
          Not affiliated with DoorDash. First-amendment-protected satire.
        </div>
      )}
      <div style={{ padding: '16px 18px 10px', position: 'relative' }}>
        <div style={{
          ...discoFont(skin),
          fontSize: skin.features?.wordmarkSize ?? 28,
          color: C.ink,
          lineHeight: skin.features?.wordmarkWrap ? 1.05 : 1,
          paddingRight: 56, // reserve room for the Sun menu button
        }}>
          {copy.wordmark}
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
          <Sun size={42} showMenu />
        </button>
        <div style={{ position: 'absolute', top: 24, right: 64, pointerEvents: 'none' }}><Seagull size={18} /></div>
        <div style={{ position: 'absolute', top: 40, right: 78, pointerEvents: 'none' }}><Seagull size={12} /></div>
      </div>
    </>
  );
}

// ─── Menu / overlay panel ─────────────────────────────────────────────────────
type PanelView = 'closed' | 'menu' | 'ferry' | 'about' | 'home-station' | 'skins' | 'faqs';

type HomeStation = 'penn' | 'grand-central' | 'atlantic' | 'woodside';

const STATION_LABELS: Record<HomeStation, string> = {
  penn:            'Penn Station',
  'grand-central': 'Grand Central Madison',
  atlantic:        'Atlantic Terminal',
  woodside:        'Woodside',
};

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
  const skin = useSkin();
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
  // Rotate the card order so today is first, then the next 6 days in sequence.
  // (#57) — keeps the user landed on the day they care about most.
  const todayDow = new Date(todayNY() + 'T12:00:00').getDay();
  const startIdx = DAY_CARDS.findIndex(d => d.idx === todayDow);
  const orderedCards = startIdx === -1
    ? DAY_CARDS
    : [...DAY_CARDS.slice(startIdx), ...DAY_CARDS.slice(0, startIdx)];
  const dayCards = orderedCards.map(d => ({ ...d, trips: byDay.get(d.idx) ?? [] }));
  const haveAnyTrips = dayCards.some(d => d.trips.length > 0);
  const haveAnyTriangle = dayCards.some(d => d.trips.some(t => t.extraStops));

  const title = ferryData?.scheduleTitle || 'Ferry Schedule';
  const dateRange = shortenWeekdays(ferryData?.effectiveDateRange);

  return (
    <div>
      {/* Page header: scraped schedule title + date range */}
      <div style={{
        ...discoFont(skin), fontSize: 22,
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
          const renderItem = (t: FerryTrip, idx: number, offset: number) => {
            const eff = effectiveLabel(t);
            return (
              <li key={t.departureTime + (t.extraStops ? 'x' : '') + (eff || '')} style={{
                display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6,
                padding: '3px 0',
              }}>
                <span style={{ fontFamily: F.marker, fontSize: 14, minWidth: 18, color: C.ink, opacity: 0.5 }}>
                  {offset + idx + 1}.
                </span>
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
          const dirLabel = tab === 'to-pines' ? 'To Pines' : 'To Sayville';
          const onFerryBug = (e: MouseEvent) => {
            e.stopPropagation();
            const times = d.trips.map(t => `${fmt(t.departureTime)}${t.extraStops ? ' ▲' : ''}`);
            reportBug({
              type: 'ferry-day',
              title: `[Ferry Error] ${dirLabel} – ${d.label}`,
              details: {
                direction: dirLabel,
                day: d.label,
                schedule: title,
                effective: dateRange || null,
                source: ferryData?.sourcePageUrl || null,
                times,
              },
            });
            track('report_ferry_error', { direction: tab, day: d.label });
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
                    <ol style={{ flex: 1, margin: 0, paddingInlineStart: 0, listStyle: 'none' }}>
                      {left.map((t, i) => renderItem(t, i, 0))}
                    </ol>
                    {right.length > 0 && (
                      <ol style={{ flex: 1, margin: 0, paddingInlineStart: 0, listStyle: 'none' }}>
                        {right.map((t, i) => renderItem(t, i, half))}
                      </ol>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button onClick={onFerryBug} aria-label="report ferry schedule error" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    border: '1.2px solid ' + C.ink,
                    background: 'rgba(255,255,255,0.7)', color: C.ink, cursor: 'pointer',
                    borderRadius: 999, padding: '3px 9px',
                    fontFamily: F.marker, fontSize: 11, letterSpacing: 0.6,
                    boxShadow: '1px 1.5px 0 ' + C.ink,
                  }}>
                    <svg width="11" height="11" viewBox="0 0 14 14">
                      <g stroke={C.ink} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#wobble)">
                        <ellipse cx="7" cy="8.5" rx="3" ry="3.8" />
                        <circle cx="7" cy="3.8" r="1.6" />
                        <line x1="4" y1="7" x2="1.5" y2="5.5" />
                        <line x1="4" y1="8.5" x2="1.5" y2="8.5" />
                        <line x1="4" y1="10" x2="1.5" y2="11.5" />
                        <line x1="10" y1="7" x2="12.5" y2="5.5" />
                        <line x1="10" y1="8.5" x2="12.5" y2="8.5" />
                        <line x1="10" y1="10" x2="12.5" y2="11.5" />
                        <line x1="6" y1="2.4" x2="4.5" y2="1" />
                        <line x1="8" y1="2.4" x2="9.5" y2="1" />
                      </g>
                    </svg>
                    BUG
                  </button>
                </div>
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

function FaqEntry({ q, children }: { q: string; children: React.ReactNode }) {
  const C = useTheme();
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontFamily: F.marker, fontSize: 15, fontWeight: 700,
        color: C.ink, marginBottom: 6, lineHeight: 1.3,
      }}>
        {q}
      </div>
      <div style={{
        fontFamily: F.hand, fontSize: 15, color: C.ink,
        lineHeight: 1.55, whiteSpace: 'pre-wrap',
      }}>
        {children}
      </div>
      <div style={{ borderBottom: '1px dashed ' + C.ink, opacity: 0.2, marginTop: 18 }} />
    </div>
  );
}

function FaqsView() {
  const C = useTheme();
  const skin = useSkin();
  return (
    <div>
      <div style={{ ...discoFont(skin), fontSize: 22, color: C.ink, marginBottom: 18 }}>
        FAQs
      </div>
      <FaqEntry q="How are trips rated green, yellow, or red?">
        {'Every trip gets a rating based on two things: how long the whole journey takes door-to-door, and how much breathing room you have at Sayville between your train and the ferry.\n\n'}
        <span style={{ color: C.green, fontWeight: 700 }}>Green (best)</span>
        {' — under 3 hours total, with at least 20 minutes between your train arriving and the ferry leaving. You can walk to the dock without rushing.\n\n'}
        <span style={{ color: C.amber, fontWeight: 700 }}>Yellow (risky)</span>
        {' — under 3 hours total, but less than 20 minutes at Sayville. Your train and the ferry are close together — a delay could mean a missed boat.\n\n'}
        <span style={{ color: C.red, fontWeight: 700 }}>Red (long)</span>
        {' — the total trip is 3 hours or more, regardless of your layover. A long day either way.'}
      </FaqEntry>
      <FaqEntry q="Why doesn't the earliest ferry show up in my trip options?">
        {'The app only shows complete door-to-door trips you can make by LIRR. To catch the 7:00a ferry, your train would need to reach Sayville by 6:50a — but no LIRR train departing from Penn, Grand Central, Atlantic Terminal, or Woodside at a practical hour arrives that early. The Montauk Branch simply doesn\'t have that morning service.\n\nThe 7:00a ferry is real and visible in the Ferry Schedule tab. It\'s just only reachable if you drive or are already out east.'}
      </FaqEntry>
    </div>
  );
}

function AboutView() {
  const C = useTheme();
  const skin = useSkin();
  return (
    <div>
      <div style={{ ...discoFont(skin), fontSize: 22, color: C.ink, marginBottom: 14 }}>
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
  { id: 'penn',          label: 'Penn Station',        available: true  },
  { id: 'grand-central', label: 'Grand Central Madison', available: true  },
  { id: 'atlantic',      label: 'Atlantic Terminal',   available: true  },
  { id: 'woodside',      label: 'Woodside',            available: true  },
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
        onClick={() => reportBug({
          type: 'station-request',
          title: '[Station Request]',
        })}
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
  const activeSkinObj = useSkin();
  const SWATCHES: (keyof SkinPalette)[] = ['coral', 'ocean', 'sand', 'green', 'amber', 'ink'];
  return (
    <div>
      <div style={{ ...discoFont(activeSkinObj), fontSize: 22, color: C.ink, marginBottom: 14 }}>
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
            <div style={{ ...discoFont(useSkin()), fontSize: 22, color: C.ink }}>
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
            <MenuLink label="FAQs"           onClick={() => setView('faqs')} />
            <MenuLink label="About"          onClick={() => setView('about')} />
          </div>
        )}
        {view === 'ferry'        && <FerryScheduleView ferryData={ferryData} ferryMock={ferryMock} />}
        {view === 'home-station' && <HomeStationView selected={homeStation} onSelect={s => { setHomeStation(s); }} />}
        {view === 'about'        && <AboutView />}
        {view === 'faqs'         && <FaqsView />}
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
  const [skinId, setSkinId]       = useState<string>(() => {
    // One-time migration: force every visitor to land on the current default
    // skin the first time they hit a build that has this flag bumped. After
    // the migration they can still toggle skins via the menu and that choice
    // persists. v1 → Grandmas (May 2026), v2 → Bianchi.
    const FORCE_KEY = 'gopines-skin-force-v2';
    if (!localStorage.getItem(FORCE_KEY)) {
      localStorage.setItem('gopines-skin', 'bianchi');
      localStorage.setItem(FORCE_KEY, '1');
      return 'bianchi';
    }
    return localStorage.getItem('gopines-skin') ?? 'bianchi';
  });
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
      fetch(`/api/lirrScheduleLive?days=14&origin=${homeStation}`).then(r => r.json() as Promise<ScheduleResp>),
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
  }, [homeStation]);

  const selectedDay = lirrData?.days?.find(d => d.date === dates[dateIdx].dateStr);
  const ferryTrips  = ferryData?.trips ?? [];

  const dowFor = (dateStr: string) => new Date(dateStr + 'T12:00:00').getDay();
  const selectedDow = dowFor(dates[dateIdx].dateStr);
  const todayDow    = dowFor(today);

  // When viewing today, hide trips whose departure is already in the past.
  // Future dates show the full day; past dates ditto (unlikely but harmless).
  const isToday = dates[dateIdx].dateStr === today;
  let itineraries: Itinerary[] = [];
  let allTripsElapsed = false;
  if (selectedDay && ferryTrips.length) {
    const raw = direction === 'to-pines'
      ? buildToPines(selectedDay.outbound, ferryTrips, selectedDow, dates[dateIdx].dateStr)
      : buildToPenn(selectedDay.inbound, ferryTrips, selectedDow, dates[dateIdx].dateStr);
    if (isToday) {
      const nowM = toMin(nowNY());
      const remaining = raw.filter(it => toMin(it.departRaw) > nowM);
      allTripsElapsed = raw.length > 0 && remaining.length === 0;
      itineraries = sort === 'latest' ? [...remaining].reverse() : remaining;
    } else {
      itineraries = sort === 'latest' ? [...raw].reverse() : raw;
    }
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
    <SkinContext.Provider value={activeSkin}>
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
          originLabel={STATION_LABELS[homeStation]}
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
        // Distinguish "filters hiding trips" from "no schedule data yet". The
        // LIRR static feed sometimes lags by a day across schedule transitions
        // (#62: 5/31/26 went blank when the cache held the pre-summer feed),
        // so when the day block exists but has no trains, say so instead of
        // blaming the filter chips.
        const lirrMissing = !!lirrData && !selectedDay;
        const lirrEmpty = !!selectedDay &&
          selectedDay.outbound.length === 0 &&
          selectedDay.inbound.length === 0;
        const emptyMessage = (() => {
          if (lirrMissing || lirrEmpty) {
            return "Schedule data for this date isn't available yet — usually refreshes overnight.";
          }
          if (qualities.length === 0) {
            return 'No quality filters selected — tap a chip above to see trips.';
          }
          if (allTripsElapsed) {
            return direction === 'to-pines'
              ? skinCopy(activeSkin).emptyToPines
              : skinCopy(activeSkin).emptyToPenn;
          }
          if (itineraries.length === 0) {
            return 'No connecting trips for this date.';
          }
          return 'No trips match the selected quality filters.';
        })();
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
                  {emptyMessage}
                </div>
              ) : (
                filtered.map(it => (
                  <ItineraryRow key={it.id} it={it} direction={direction} dateLabel={selectedDateLabel} dateStr={dates[dateIdx].dateStr} originLabel={STATION_LABELS[homeStation]} />
                ))
              )}
            </div>
          </>
        );
      })()}

      <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 10px' }}>
        <Wave width={120} />
      </div>
      <div style={{ textAlign: 'center', fontFamily: F.hand, fontSize: 13, color: '#9b958c', paddingBottom: 8 }}>
        ferry data scraped daily · LIRR via open feed
      </div>
      <div style={{ textAlign: 'center', paddingBottom: 24 }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            reportBug({
              type: 'general',
              details: {
                date: dates[dateIdx]?.dateStr ?? 'unknown',
                direction,
              },
            });
          }}
          style={{ fontFamily: F.hand, fontSize: 13, color: '#9b958c', textDecoration: 'underline', cursor: 'pointer' }}
        >
          report a bug
        </a>
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
    </SkinContext.Provider>
  );
}
