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
/** Reports listed on each side of the one being asked about. */
const NEIGHBOURS_EACH_SIDE = 3;

const CONTEXT =
  "One Apple Find My location report for a Bluetooth tracker tag (\"this\"), with the reports just before and after it. " +
  "Each position comes from whichever nearby iPhone heard the tag, with its own accuracy radius and Apple confidence. " +
  "Neighbours are listed nearest in time first. dist_m, east_m and north_m are straight-line offsets from this report. " +
  "min_speed_kmh is the lowest speed that could explain the move between this report and that neighbour " +
  "(distance minus both accuracy radii, divided by the time between them); the real speed may be higher.";

/**
 * Builds one Jev description per report: the report itself plus the raw facts of its nearest reports in time,
 * so Jev can judge consistency itself (no glitch rules of ours). `reports` must be sorted by seen time.
 * Only relative facts are included: never coordinates.
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

  const neighbour = (i: number, j: number, side: "before" | "after") => {
    // Offsets in metres from report i (small-distance approximation is fine at these scales).
    const kx = 111_320 * Math.cos((pts[i].lat * Math.PI) / 180);
    return {
      [side === "before" ? "min_before" : "min_after"]: round(Math.abs(pts[i].t - pts[j].t) / 60000, 1),
      dist_m: round(dist(i, j)),
      east_m: round((pts[j].lon - pts[i].lon) * kx, -1),
      north_m: round((pts[j].lat - pts[i].lat) * 110_540, -1),
      accuracy_m: pts[j].acc,
      apple_confidence: CONFIDENCE_WORDS[pts[j].conf] ?? "unknown",
      min_speed_kmh: minSpeedKmh(i, j),
    };
  };

  let lo = 0;
  let hi = 0;

  return pts.map((p, i) => {
    // Sliding ±30 min window (pts are time-sorted), summarised with medians only.
    while (pts[lo].t < p.t - WINDOW_MS) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < pts.length && pts[hi + 1].t <= p.t + WINDOW_MS) hi++;
    const others: number[] = [];
    for (let j = lo; j <= hi; j++) if (j !== i) others.push(j);

    const before: ReturnType<typeof neighbour>[] = [];
    for (let j = i - 1; j >= 0 && before.length < NEIGHBOURS_EACH_SIDE; j--) before.push(neighbour(i, j, "before"));
    const after: ReturnType<typeof neighbour>[] = [];
    for (let j = i + 1; j < pts.length && after.length < NEIGHBOURS_EACH_SIDE; j++) after.push(neighbour(i, j, "after"));

    const features: Record<string, unknown> = {
      this: {
        seen_local: new Date(p.t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }),
        accuracy_m: p.acc,
        apple_confidence: CONFIDENCE_WORDS[p.conf] ?? "unknown",
        ...(p.received ? { delay_until_server_min: round((p.received - p.t) / 60000) } : {}),
      },
      before,
      after,
      reports_within_30min: others.length,
    };
    if (others.length > 0) {
      const cLat = median(others.map((j) => pts[j].lat));
      const cLon = median(others.map((j) => pts[j].lon));
      features.dist_to_median_of_30min_reports_m = round(haversineM(p.lat, p.lon, cLat, cLon));
      features.median_spread_of_30min_reports_m = round(
        median(others.map((j) => haversineM(pts[j].lat, pts[j].lon, cLat, cLon))),
      );
    }

    return `${CONTEXT}\n${JSON.stringify(features)}`;
  });
}
