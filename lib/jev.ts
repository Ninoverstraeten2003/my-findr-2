// Jev (TypeSafe's structured decision model, served by OpenRouter) labels for report dots.
// Pure helpers shared by the settings editor, the map panel and the Leaflet markers.


export const JEV_MODEL = "typesafe/jev-1.13";
/** OpenRouter list price for typesafe/jev-1.13: $0.042 per 1M input tokens, output is free. */
export const JEV_PRICE_PER_M_INPUT_TOKENS = 0.042;

// Server-side limits (mirrored by app/api/jev/route.ts).
export const JEV_MAX_QUESTIONS = 8;
export const JEV_MAX_ITEMS_PER_CALL = 20;
export const JEV_MAX_STATE_CHARS = 4000;
export const JEV_MAX_INSTRUCTION_CHARS = 600;
export const JEV_MAX_OPTION_CHARS = 400;

export type JevMark =
  | "dot"
  | "ring"
  | "dashed"
  | "square"
  | "triangle"
  | "diamond"
  | "cross"
  | "double";

export const JEV_MARKS: { value: JevMark; label: string }[] = [
  { value: "dot", label: "Normal dot" },
  { value: "ring", label: "Hollow ring" },
  { value: "dashed", label: "Dashed ring" },
  { value: "square", label: "Square" },
  { value: "triangle", label: "Triangle" },
  { value: "diamond", label: "Diamond" },
  { value: "cross", label: "Cross" },
  { value: "double", label: "Dot with halo" },
];

export type JevQuestionType = "choice" | "noul" | "score";

export interface JevAnswerOption {
  /** choice: slug; noul: "true" | "false" | "unsure"; score: level index as string */
  key: string;
  label: string;
  /** Sent to Jev as the option's criterion (not used for the noul "unsure" bucket). */
  description: string;
  mark: JevMark;
}

export interface JevQuestionConfig {
  id: string;
  title: string;
  type: JevQuestionType;
  instructions: string;
  options: JevAnswerOption[];
}

export interface JevConfig {
  enabled: boolean;
  /** The user's own OpenRouter key (stored on this device only). When set, the user pays and no token is needed. */
  userApiKey: string;
  /** Site owner only: must match JEV_ACCESS_TOKEN on the server to use the owner's shared OpenRouter key. */
  accessToken: string;
  maxCostPerRunUsd: number;
  maxReportsPerRun: number;
  activeQuestionId: string | null;
  /** Running total of what OpenRouter reported, kept on this device only. */
  spentUsd: number;
  questions: JevQuestionConfig[];
}

// A noul answer between these bounds is shown as "unsure".
export const NOUL_YES_AT = 0.65;
export const NOUL_NO_AT = 0.35;

export const DEFAULT_JEV_QUESTIONS: JevQuestionConfig[] = [
  {
    id: "glitch",
    title: "Glitch?",
    type: "noul",
    instructions:
      "Is this report most likely a position glitch rather than where the tag really was at that time?",
    options: [
      {
        key: "true",
        label: "Likely glitch",
        description:
          "The position does not fit its neighbours: an impossible minimum speed, a jump away that comes straight back, far from the reports around it, or poor accuracy with low Apple confidence.",
        mark: "cross",
      },
      {
        key: "false",
        label: "Fits neighbours",
        description:
          "The position is consistent with the reports before and after it in time and distance.",
        mark: "dot",
      },
      { key: "unsure", label: "Unsure", description: "", mark: "dashed" },
    ],
  },
  {
    id: "movement",
    title: "Movement",
    type: "choice",
    instructions:
      "What was the tag most likely doing around the time of this report? Speeds are minimum possible speeds, so real speeds can be higher.",
    options: [
      {
        key: "stationary",
        label: "Stationary",
        description: "Reports around it stay in the same place, within their accuracy.",
        mark: "square",
      },
      {
        key: "walking",
        label: "Walking pace",
        description: "Slow, steady movement, roughly 2 to 7 km/h.",
        mark: "triangle",
      },
      {
        key: "vehicle",
        label: "Vehicle",
        description: "Movement clearly faster than walking or cycling, such as a car or train.",
        mark: "diamond",
      },
      {
        key: "unclear",
        label: "Unclear",
        description: "Too few nearby reports or too inconsistent to tell.",
        mark: "dashed",
      },
    ],
  },
  {
    id: "trust",
    title: "Trust",
    type: "score",
    instructions:
      "How much would you trust this report's position when estimating where the tag is?",
    options: [
      { key: "0", label: "Don't trust", description: "Almost certainly wrong or far too vague to use.", mark: "ring" },
      { key: "1", label: "Weak", description: "Usable only as a rough hint.", mark: "dashed" },
      { key: "2", label: "Good", description: "Reasonable position, consistent with neighbours.", mark: "dot" },
      { key: "3", label: "Strong", description: "Precise and well supported by nearby reports.", mark: "double" },
    ],
  },
];

export const DEFAULT_JEV_CONFIG: JevConfig = {
  enabled: false,
  userApiKey: "",
  accessToken: "",
  maxCostPerRunUsd: 0.05,
  maxReportsPerRun: 2000,
  activeQuestionId: "glitch",
  spentUsd: 0,
  questions: DEFAULT_JEV_QUESTIONS,
};

// ── Wire format ───────────────────────────────────────────────────────

export type JevWireQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevRawAnswer =
  | { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; confidence?: number; probabilities?: Record<string, number> };

export function toWireQuestion(q: JevQuestionConfig): JevWireQuestion {
  if (q.type === "noul") {
    const yes = q.options.find((o) => o.key === "true")?.description ?? "Yes";
    const no = q.options.find((o) => o.key === "false")?.description ?? "No";
    return { type: "noul", instructions: q.instructions, criteria: { true: yes, false: no } };
  }
  if (q.type === "score") {
    return { type: "score", instructions: q.instructions, criteria: q.options.map((o) => o.description || o.label) };
  }
  return {
    type: "choice",
    instructions: q.instructions,
    criteria: Object.fromEntries(q.options.map((o) => [o.key, o.description || o.label])),
  };
}

/** Returns a reason the question can't be sent, or null when it is valid. */
export function validateQuestion(q: JevQuestionConfig): string | null {
  if (!/^[A-Za-z0-9_]{1,40}$/.test(q.id)) return "Question id may only use letters, digits and _";
  if (!q.title.trim()) return "Give the question a short title";
  if (!q.instructions.trim()) return "The question text is empty";
  if (q.instructions.length > JEV_MAX_INSTRUCTION_CHARS) return `Question text is over ${JEV_MAX_INSTRUCTION_CHARS} characters`;
  const sent = q.type === "noul" ? q.options.filter((o) => o.key !== "unsure") : q.options;
  if (q.type === "choice" && (sent.length < 2 || sent.length > 16)) return "A choice needs 2 to 16 answers";
  if (q.type === "score" && (sent.length < 2 || sent.length > 10)) return "A score needs 2 to 10 levels";
  if (q.type === "noul" && sent.length !== 2) return "A yes/no question needs a yes and a no answer";
  for (const o of sent) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(o.key)) return `Answer "${o.label}" has an invalid key`;
    if (!(o.description || o.label).trim()) return `Answer "${o.label}" needs a description`;
    if ((o.description || o.label).length > JEV_MAX_OPTION_CHARS) return `Answer "${o.label}" is over ${JEV_MAX_OPTION_CHARS} characters`;
  }
  if (new Set(sent.map((o) => o.key)).size !== sent.length) return "Two answers share the same key";
  return null;
}

export function slugKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "answer";
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}_${i}`;
  return key;
}

// ── Answers ───────────────────────────────────────────────────────────

export interface JevLabel {
  optionKey: string;
  label: string;
  mark: JevMark;
  /** Probability of the shown answer, 0..1. */
  prob: number;
  /** Short human summary, e.g. "Vehicle 72% · Walking pace 18%". */
  detail: string;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function labelAnswer(q: JevQuestionConfig, a: JevRawAnswer | undefined): JevLabel | null {
  if (!a || a.type !== q.type) return null;
  const opt = (key: string) => q.options.find((o) => o.key === key);

  if (a.type === "noul") {
    const p = a.noul;
    const key = p >= NOUL_YES_AT ? "true" : p <= NOUL_NO_AT ? "false" : "unsure";
    const o = opt(key);
    const prob = key === "false" ? 1 - p : key === "true" ? p : Math.max(p, 1 - p);
    return {
      optionKey: key,
      label: o?.label ?? key,
      mark: o?.mark ?? "dot",
      prob,
      detail: `yes ${pct(p)}`,
    };
  }

  const probs = a.probabilities ?? {};
  const ranked = Object.entries(probs).sort((x, y) => y[1] - x[1]);

  if (a.type === "score") {
    const level = String(Math.max(0, Math.min(q.options.length - 1, Math.round(a.score))));
    const o = opt(level);
    const detail =
      `${a.score.toFixed(1)} of ${q.options.length - 1}` +
      (ranked.length ? ` · ${ranked.slice(0, 2).map(([k, p]) => `${opt(k)?.label ?? k} ${pct(p)}`).join(" · ")}` : "");
    return {
      optionKey: level,
      label: o?.label ?? level,
      mark: o?.mark ?? "dot",
      prob: probs[level] ?? a.confidence ?? 0,
      detail,
    };
  }

  const o = opt(a.choice);
  return {
    optionKey: a.choice,
    label: o?.label ?? a.choice,
    mark: o?.mark ?? "dot",
    prob: probs[a.choice] ?? a.confidence ?? 0,
    detail: ranked.slice(0, 3).map(([k, p]) => `${opt(k)?.label ?? k} ${pct(p)}`).join(" · "),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Tooltip HTML listing each question's answer for one report (styled by .jev-tip in leaflet-map). */
export function jevTooltipHtml(rows: { title: string; label: string; detail: string; active: boolean }[]): string {
  if (!rows.length) return "";
  return `<div class="jev-tip">${rows
    .map(
      (r) =>
        `<div class="jev-tip-row${r.active ? " jev-tip-active" : ""}"><span class="jev-tip-q">${escapeHtml(r.title)}</span> ${escapeHtml(r.label)}<div class="jev-tip-detail">${escapeHtml(r.detail)}</div></div>`,
    )
    .join("")}</div>`;
}

// ── Cost ──────────────────────────────────────────────────────────────

/**
 * Conservative token guess. Calibrated on a real call: ~1,650 chars of state + 3 questions
 * was billed as 714 input tokens, so Jev adds overhead beyond the raw text.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 2.5) + 100;
}

export function tokensToUsd(tokens: number): number {
  return (tokens / 1_000_000) * JEV_PRICE_PER_M_INPUT_TOKENS;
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.0001) return "< $0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

// ── Hashing & cache ───────────────────────────────────────────────────

/** Two FNV-1a passes with different seeds: short, stable, collision-safe enough for a cache key. */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/**
 * Bump when the report description format (lib/report-features.ts) changes: answers given for an older
 * format are then asked again once.
 */
export const FEATURE_VERSION = 2;

/** Identifies a question's content (model + description format + wording), so editing a question re-asks only it. */
export function questionHash(q: JevQuestionConfig): string {
  return hashString(JSON.stringify([JEV_MODEL, FEATURE_VERSION, toWireQuestion(q)]));
}

// Each report is asked once per question; the answer is kept whatever the history length or new reports.
const CACHE_KEY = "findr-jev-cache-v2";
/** Older format keyed by description text; its answers don't apply to the current format, so it's removed. */
const OLD_CACHE_KEYS = ["findr-jev-cache-v1"];
const CACHE_MAX_ENTRIES = 30_000;

type CacheStore = Record<string, JevRawAnswer>;

let memoryCache: CacheStore | null = null;

function loadCache(): CacheStore {
  if (memoryCache) return memoryCache;
  try {
    for (const k of OLD_CACHE_KEYS) localStorage.removeItem(k);
    memoryCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as CacheStore;
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

export function getCachedAnswer(qHash: string, reportKey: string): JevRawAnswer | undefined {
  return loadCache()[`${qHash}:${reportKey}`];
}

function compact(a: JevRawAnswer): JevRawAnswer {
  const round = (p?: Record<string, number>) =>
    p && Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  if (a.type === "noul") return { type: "noul", noul: Math.round(a.noul * 1000) / 1000 };
  if (a.type === "score") return { type: "score", score: a.score, confidence: a.confidence, probabilities: round(a.probabilities) };
  return { type: "choice", choice: a.choice, confidence: a.confidence, probabilities: round(a.probabilities) };
}

export function putCachedAnswers(entries: [string, JevRawAnswer][]) {
  if (!entries.length) return;
  const cache = loadCache();
  for (const [k, a] of entries) cache[k] = compact(a);
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX_ENTRIES) {
    // Insertion order is kept by JS objects, so the oldest entries go first.
    for (const k of keys.slice(0, keys.length - CACHE_MAX_ENTRIES)) delete cache[k];
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full: keep the newest half and try once more.
    const all = Object.keys(cache);
    for (const k of all.slice(0, Math.floor(all.length / 2))) delete cache[k];
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* answers stay in memory for this session */
    }
  }
}

export function clearJevCache() {
  memoryCache = {};
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function jevCacheSize(): number {
  return Object.keys(loadCache()).length;
}

// ── Marker shapes (device color stays the fill; shape carries the label) ──

export function markSvg(mark: JevMark, fill: string, outline: string, size = 14): string {
  const s = size;
  const c = s / 2;
  const r = s / 2 - 1.5;
  const common = `stroke="${outline}" stroke-width="1"`;
  let body: string;
  switch (mark) {
    case "ring":
      body = `<circle cx="${c}" cy="${c}" r="${r - 0.5}" fill="none" stroke="${fill}" stroke-width="2.5"/>
              <circle cx="${c}" cy="${c}" r="${r + 0.9}" fill="none" ${common} stroke-opacity="0.6"/>`;
      break;
    case "dashed":
      body = `<circle cx="${c}" cy="${c}" r="${r - 0.5}" fill="${fill}" fill-opacity="0.35" stroke="${fill}" stroke-width="2" stroke-dasharray="2.5 2"/>`;
      break;
    case "square":
      body = `<rect x="${c - r * 0.85}" y="${c - r * 0.85}" width="${r * 1.7}" height="${r * 1.7}" rx="1" fill="${fill}" ${common}/>`;
      break;
    case "triangle":
      body = `<polygon points="${c},${c - r} ${c + r},${c + r * 0.8} ${c - r},${c + r * 0.8}" fill="${fill}" ${common} stroke-linejoin="round"/>`;
      break;
    case "diamond":
      body = `<polygon points="${c},${c - r} ${c + r},${c} ${c},${c + r} ${c - r},${c}" fill="${fill}" ${common} stroke-linejoin="round"/>`;
      break;
    case "cross":
      body = `<path d="M${c - r * 0.8},${c - r * 0.8} L${c + r * 0.8},${c + r * 0.8} M${c + r * 0.8},${c - r * 0.8} L${c - r * 0.8},${c + r * 0.8}" stroke="${outline}" stroke-width="4.5" stroke-linecap="round"/>
              <path d="M${c - r * 0.8},${c - r * 0.8} L${c + r * 0.8},${c + r * 0.8} M${c + r * 0.8},${c - r * 0.8} L${c - r * 0.8},${c + r * 0.8}" stroke="${fill}" stroke-width="2.5" stroke-linecap="round"/>`;
      break;
    case "double":
      body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${fill}" stroke-width="1.2"/>
              <circle cx="${c}" cy="${c}" r="${r * 0.55}" fill="${fill}" ${common}/>`;
      break;
    default:
      body = `<circle cx="${c}" cy="${c}" r="${r * 0.75}" fill="${fill}" ${common}/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${body}</svg>`;
}
