// One accuracy level per report, shown by the shape of its dot (the legend explains them; colour stays the
// device's). It combines two things:
//  - Consistency: does the report fit the reports just before and after it?
//  - Trust: Apple's confidence for it, and how small its accuracy radius is.
// Plain rules on the decrypted reports, worked out in this browser. Reports are never hidden, only marked.

import { findSpikes } from "./trail";

export type Quality = "reliable" | "approximate" | "doubtful";

export interface ReportQuality {
  level: Quality;
  /** Short reason, e.g. "±120 m". */
  why: string;
}

export interface QualityInput {
  lat: number;
  lon: number;
  /** Accuracy radius, metres. */
  acc: number;
  /** Seen time, ms. */
  t: number;
  /** Apple confidence, 1-3. */
  confidence: number;
}

/** Largest accuracy radius a reliable report may have. */
export const RELIABLE_MAX_ACCURACY_M = 50;
/** Faster than any car or train: a move that needs more than this, even using both accuracy radii, didn't happen. */
export const MAX_PLAUSIBLE_KMH = 300;
/** Report times are rounded, so very close reports are treated as at least this far apart. */
const MIN_GAP_MS = 60_000;

export const QUALITY_LEGEND: { level: Quality; label: string; description: string }[] = [
  {
    level: "reliable",
    label: "Reliable",
    description: `Fits the reports around it, Apple confidence high, within ${RELIABLE_MAX_ACCURACY_M} m`,
  },
  {
    level: "approximate",
    label: "Approximate",
    description: `Fits the reports around it, but wider than ${RELIABLE_MAX_ACCURACY_M} m or lower Apple confidence`,
  },
  {
    level: "doubtful",
    label: "Doubtful",
    description: `Doesn't fit the reports around it: jumps away and straight back, or would need over ${MAX_PLAUSIBLE_KMH} km/h`,
  },
];

export const QUALITY_LABEL: Record<Quality, string> = {
  reliable: "Reliable",
  approximate: "Approximate",
  doubtful: "Doubtful",
};

function haversineM(a: QualityInput, b: QualityInput): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Lowest speed that explains the move between two reports: distance minus both radii, over the time between. */
function minKmh(a: QualityInput, b: QualityInput): number {
  const metres = Math.max(0, haversineM(a, b) - a.acc - b.acc);
  const hours = Math.max(Math.abs(a.t - b.t), MIN_GAP_MS) / 3_600_000;
  return metres / 1000 / hours;
}

/**
 * Too fast to fit the reports around it, while those agree with each other. In the middle: too fast from both the
 * report before and after it. At either end (one side only): too fast from the nearest report, while that one
 * agrees with the report next to it.
 */
function tooFast(pts: QualityInput[], i: number): boolean {
  const n = pts.length;
  const fast = (a: number, b: number) => minKmh(pts[a], pts[b]) > MAX_PLAUSIBLE_KMH;
  if (i > 0 && i < n - 1) return fast(i, i - 1) && fast(i, i + 1) && !fast(i - 1, i + 1);
  if (n < 3) return false;
  const [near, next] = i === 0 ? [1, 2] : [n - 2, n - 3];
  return fast(i, near) && !fast(near, next);
}

const CONFIDENCE_WORD: Record<number, string> = { 3: "high", 2: "medium", 1: "low" };

/** Accuracy level of each report; `pts` in seen-time order. O(n). */
export function classifyReports(pts: QualityInput[]): ReportQuality[] {
  const spikes = findSpikes(pts);
  return pts.map((p, i) => {
    if (spikes.has(i)) return { level: "doubtful", why: "jumps away and straight back" };
    if (tooFast(pts, i)) return { level: "doubtful", why: `would need over ${MAX_PLAUSIBLE_KMH} km/h` };
    const radius = `±${p.acc} m`;
    if (p.confidence < 3) return { level: "approximate", why: `${radius}, Apple confidence ${CONFIDENCE_WORD[p.confidence] ?? "low"}` };
    if (p.acc > RELIABLE_MAX_ACCURACY_M) return { level: "approximate", why: radius };
    return { level: "reliable", why: radius };
  });
}

/**
 * The shape for a level as SVG: reliable = filled dot, approximate = hollow ring, doubtful = cross. Drawn in the
 * device colour with a light outline so it reads on every map style.
 */
export function qualitySvg(level: Quality, color: string, size: number, outline = "#ffffff"): string {
  const c = size / 2;
  const r = size / 2 - 1.5;
  let body: string;
  switch (level) {
    case "reliable":
      body = `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" stroke="${outline}" stroke-width="1.5"/>`;
      break;
    case "approximate":
      body =
        `<circle cx="${c}" cy="${c}" r="${r}" fill="${outline}" fill-opacity="0.85" stroke="${outline}" stroke-width="1"/>` +
        `<circle cx="${c}" cy="${c}" r="${r - 1.5}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
      break;
    case "doubtful": {
      const d = r * 0.8;
      const path = `M${c - d},${c - d} L${c + d},${c + d} M${c + d},${c - d} L${c - d},${c + d}`;
      body =
        `<path d="${path}" stroke="${outline}" stroke-width="4.5" stroke-linecap="round"/>` +
        `<path d="${path}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}
