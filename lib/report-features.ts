// Turns each report into a short description of how it relates to the reports around it.
// Only relative facts leave the device (gaps, distances, minimum speeds): never coordinates.

import { hashString } from "./jev";
import type { DeviceReport } from "./types";

const keyCache = new WeakMap<DeviceReport, string>();

/** Stable id for a report across refetches (the encrypted payload is unique per report). */
export function reportKey(r: DeviceReport): string {
  let k = keyCache.get(r);
  if (!k) {
    k = hashString(r.payload);
    keyCache.set(r, k);
  }
  return k;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const round = (x: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

const CONFIDENCE_WORDS: Record<number, string> = { 3: "high", 2: "medium", 1: "low" };
const WINDOW_MS = 30 * 60 * 1000;

const CONTEXT =
  "One Apple Find My location report for a Bluetooth tracker tag, compared with the reports around it. " +
  "The position comes from whichever nearby iPhone heard the tag. Distances are straight lines. " +
  "min_speed values are the lowest speed that could explain a move (straight-line distance minus both accuracy radii, divided by time); the real speed may be higher.";

/**
 * Builds one Jev state string per report. `reports` must be sorted by seen time (as the app keeps them).
 * The strings are deterministic, so their hash doubles as a cache key.
 */
export function buildReportStates(reports: DeviceReport[]): string[] {
  const pts = reports.map((r) => ({
    t: new Date(r.decrypedPayload.date).getTime(),
    lat: r.decrypedPayload.location.latitude,
    lon: r.decrypedPayload.location.longitude,
    acc: r.decrypedPayload.location.accuracy,
    conf: r.decrypedPayload.confidence,
    received: r.receivedAt ? new Date(r.receivedAt).getTime() : null,
  }));

  const dist = (i: number, j: number) => haversineM(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon);

  const minSpeedKmh = (i: number, j: number) => {
    const dt = Math.abs(pts[j].t - pts[i].t) / 1000;
    const lower = Math.max(0, dist(i, j) - pts[i].acc - pts[j].acc);
    if (dt === 0) return lower > 0 ? "same second, different place" : 0;
    // One decimal: whole km/h would blur walking-pace speeds (5.4 -> 5, 1.2 -> 1).
    return round((lower / dt) * 3.6, 1);
  };

  let lo = 0;
  let hi = 0;

  return pts.map((p, i) => {
    const hasPrev = i > 0;
    const hasNext = i < pts.length - 1;

    // Sliding ±30 min window (pts are time-sorted).
    while (pts[lo].t < p.t - WINDOW_MS) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < pts.length && pts[hi + 1].t <= p.t + WINDOW_MS) hi++;
    const others: number[] = [];
    for (let j = lo; j <= hi; j++) if (j !== i) others.push(j);

    const features: Record<string, unknown> = {
      seen_local: new Date(p.t).toLocaleString("en-GB", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
      accuracy_m: p.acc,
      apple_confidence: CONFIDENCE_WORDS[p.conf] ?? "unknown",
      gap_prev_min: hasPrev ? round((p.t - pts[i - 1].t) / 60000, 1) : null,
      gap_next_min: hasNext ? round((pts[i + 1].t - p.t) / 60000, 1) : null,
      dist_prev_m: hasPrev ? round(dist(i, i - 1)) : null,
      dist_next_m: hasNext ? round(dist(i, i + 1)) : null,
      min_speed_from_prev_kmh: hasPrev ? minSpeedKmh(i - 1, i) : null,
      min_speed_to_next_kmh: hasNext ? minSpeedKmh(i, i + 1) : null,
    };

    if (hasPrev && hasNext) {
      const out = Math.min(dist(i, i - 1), dist(i, i + 1));
      // Same idea as min_speed: only count the part of the jump that the accuracy radii can't explain.
      const outBeyondAccuracy = Math.min(
        dist(i, i - 1) - p.acc - pts[i - 1].acc,
        dist(i, i + 1) - p.acc - pts[i + 1].acc,
      );
      features.prev_to_next_m = round(dist(i - 1, i + 1));
      // Out-and-back: this point sits clearly away from both neighbours while they sit close to each other.
      features.jumps_away_and_back = outBeyondAccuracy > 300 && dist(i - 1, i + 1) < 0.3 * out;
    }

    features.other_reports_within_30min = others.length;
    if (others.length > 0) {
      const cLat = median(others.map((j) => pts[j].lat));
      const cLon = median(others.map((j) => pts[j].lon));
      features.dist_to_nearby_median_m = round(haversineM(p.lat, p.lon, cLat, cLon));
      features.nearby_spread_m = round(median(others.map((j) => haversineM(pts[j].lat, pts[j].lon, cLat, cLon))));
      features.nearby_median_accuracy_m = round(median(others.map((j) => pts[j].acc)));
      const first = Math.min(lo, i);
      const last = Math.max(hi, i);
      if (last > first) {
        const spanS = (pts[last].t - pts[first].t) / 1000;
        const net = Math.max(0, dist(first, last) - pts[first].acc - pts[last].acc);
        features.window_net_move_m = round(dist(first, last));
        features.window_min_speed_kmh = spanS > 0 ? round((net / spanS) * 3.6, 1) : null;
      }
    }

    if (p.received) features.delay_until_server_min = round((p.received - p.t) / 60000);

    return `${CONTEXT}\n${JSON.stringify(features)}`;
  });
}
