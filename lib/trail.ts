// Builds the history trail line from time-ordered reports. It only changes how the LINE is routed:
// every report dot is still drawn by the map.
//  1. Stays: consecutive reports that sit in one place collapse into one node, so jitter stops zigzagging.
//  2. Spikes: a report that jumps away and straight back is routed around (the map draws a faint stub to it).
//  3. Shape: runs of moving reports get a smooth curve through their points; single hops (e.g. stay -> stay)
//     bend to the right of travel, so A->B and B->A don't lie on top of each other.
// Everything is O(n) and done once per data change.

export type LatLon = [number, number];

export interface TrailInput {
  lat: number;
  lon: number;
  /** Accuracy radius in metres. */
  acc: number;
  /** Seen time, ms. */
  t: number;
}

export interface Stay {
  center: LatLon;
  /** Metres: how far the stay's reports spread around the centre (at least MIN_STAY_RADIUS_M). */
  radiusM: number;
  start: number;
  end: number;
  indices: number[];
}

export interface Trail {
  /** Polylines to draw; each is in travel order, so arrows can follow it. */
  paths: LatLon[][];
  /** Faint stubs from the point before a spike to the spike itself. */
  spikeStubs: [LatLon, LatLon][];
  stays: Stay[];
  spikeIndices: Set<number>;
}

const STAY_MIN_JOIN_M = 75;
const STAY_MAX_JOIN_M = 200;
/** Reported accuracy is roughly 1 sigma, so a stationary tag regularly lands beyond it; join within 1.5x. */
const STAY_JOIN_ACCURACY_FACTOR = 1.5;
const MIN_STAY_RADIUS_M = 25;
const SPIKE_BEYOND_ACCURACY_M = 300;
const ARC_BEND = 0.15;
const ARC_SAMPLES = 12;
const SPLINE_SAMPLES_PER_SEGMENT = 6;

function haversineM(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Local flat projection in metres (good enough for the few-km bends and curves drawn here).
function projector(lat0: number) {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  return {
    to: (p: LatLon): [number, number] => [p[1] * kx, p[0] * ky],
    from: (x: number, y: number): LatLon => [y / ky, x / kx],
  };
}

/** Quadratic arc from a to b, bulging to the right of the direction of travel. */
function arc(a: LatLon, b: LatLon): LatLon[] {
  const P = projector((a[0] + b[0]) / 2);
  const [ax, ay] = P.to(a);
  const [bx, by] = P.to(b);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [a, b];
  // Right-hand normal of (dx, dy) with y pointing north.
  const nx = dy / len;
  const ny = -dx / len;
  const bend = len * ARC_BEND;
  const cx = (ax + bx) / 2 + nx * bend;
  const cy = (ay + by) / 2 + ny * bend;
  const out: LatLon[] = [];
  for (let s = 0; s <= ARC_SAMPLES; s++) {
    const t = s / ARC_SAMPLES;
    const u = 1 - t;
    out.push(P.from(u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by));
  }
  return out;
}

/** Centripetal Catmull-Rom through every point (no overshoot on uneven spacing). */
function spline(points: LatLon[]): LatLon[] {
  if (points.length < 3) return points;
  const P = projector(points[Math.floor(points.length / 2)][0]);
  const xy = points.map(P.to);
  const pts = [xy[0], ...xy, xy[xy.length - 1]];
  const out: LatLon[] = [points[0]];
  const knot = (ti: number, a: number[], b: number[]) => ti + Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-6);

  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    const t0 = 0;
    const t1 = knot(t0, p0, p1);
    const t2 = knot(t1, p1, p2);
    const t3 = knot(t2, p2, p3);
    for (let s = 1; s <= SPLINE_SAMPLES_PER_SEGMENT; s++) {
      const t = t1 + ((t2 - t1) * s) / SPLINE_SAMPLES_PER_SEGMENT;
      const lerp = (a: number[], b: number[], ta: number, tb: number) =>
        [0, 1].map((k) => ((tb - t) / (tb - ta)) * a[k] + ((t - ta) / (tb - ta)) * b[k]);
      const A1 = lerp(p0, p1, t0, t1);
      const A2 = lerp(p1, p2, t1, t2);
      const A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2);
      const B2 = lerp(A2, A3, t1, t3);
      const C = lerp(B1, B2, t1, t2);
      out.push(P.from(C[0], C[1]));
    }
  }
  return out;
}

/** Out-and-back check, accuracy-aware (same rule as the Jev features). */
function findSpikes(pts: TrailInput[]): Set<number> {
  const spikes = new Set<number>();
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const dA = haversineM([p.lat, p.lon], [a.lat, a.lon]);
    const dB = haversineM([p.lat, p.lon], [b.lat, b.lon]);
    const beyond = Math.min(dA - p.acc - a.acc, dB - p.acc - b.acc);
    if (beyond > SPIKE_BEYOND_ACCURACY_M && haversineM([a.lat, a.lon], [b.lat, b.lon]) < 0.3 * Math.min(dA, dB)) {
      spikes.add(i);
    }
  }
  return spikes;
}

const MERGE_STAYS_M = 100;
const STRAY_MIN_M = 150;
/** A group only counts as a stay if the tag was there this long; shorter groups (e.g. a walk with
 *  reports every 30 s) stay as moving points so the line runs smoothly through them. */
const MIN_STAY_MS = 10 * 60 * 1000;

function groupCenter(g: number[], pts: TrailInput[]): LatLon {
  return [g.reduce((s, i) => s + pts[i].lat, 0) / g.length, g.reduce((s, i) => s + pts[i].lon, 0) / g.length];
}

/**
 * Second pass over the groups. Jitter just beyond the join radius leaves stray single reports around a stay
 * (or splits one stay in two), and the line would loop through them. Repeated until nothing changes:
 *  - a single report next to a stay joins it if it's within max(150 m, 1.5 x its accuracy) of the stay's centre;
 *  - neighbouring stays whose centres are within MERGE_STAYS_M merge.
 * Reports further out stay separate, so real short trips remain visible.
 */
function mergeJitter(groups: number[][], pts: TrailInput[]): number[][] {
  let gs = groups.map((g) => [...g]);
  const isStay = (g: number[]) => g.length >= 2;
  const closeToStay = (i: number, stay: number[]) => {
    const p = pts[i];
    return haversineM(groupCenter(stay, pts), [p.lat, p.lon]) <= Math.max(STRAY_MIN_M, 1.5 * p.acc);
  };
  for (let changed = true, rounds = 0; changed && rounds < 10; rounds++) {
    changed = false;
    const out: number[][] = [];
    for (let k = 0; k < gs.length; k++) {
      const g = gs[k];
      const prev = out[out.length - 1];
      const next = gs[k + 1];
      if (!isStay(g)) {
        if (prev && isStay(prev) && closeToStay(g[0], prev)) {
          prev.push(...g);
          changed = true;
          continue;
        }
        if (next && isStay(next) && closeToStay(g[0], next)) {
          next.unshift(...g);
          changed = true;
          continue;
        }
      } else if (prev && isStay(prev) && haversineM(groupCenter(prev, pts), groupCenter(g, pts)) <= MERGE_STAYS_M) {
        prev.push(...g);
        changed = true;
        continue;
      }
      out.push(g);
    }
    gs = out;
  }
  return gs;
}

type Node = { pos: LatLon; stay: Stay | null };

/**
 * @param pts reports in seen-time order
 * @param endAt optional position for the final node (the map's "best location" marker)
 */
export function buildTrail(pts: TrailInput[], endAt?: LatLon): Trail {
  const empty: Trail = { paths: [], spikeStubs: [], stays: [], spikeIndices: new Set() };
  if (pts.length === 0) return empty;

  const spikeIndices = findSpikes(pts);

  // Group consecutive non-spike reports into stays. A report joins when it's near the running centre
  // (1.5x its own accuracy, 75-200 m). The centre is a mean of everything so far, so it lags behind
  // a walker and a real walk breaks out of the stay within a few hundred metres.
  const groups: number[][] = [];
  let cur: number[] = [];
  let sumLat = 0;
  let sumLon = 0;
  for (let i = 0; i < pts.length; i++) {
    if (spikeIndices.has(i)) continue;
    const p = pts[i];
    const joinR = Math.min(STAY_MAX_JOIN_M, Math.max(STAY_MIN_JOIN_M, p.acc * STAY_JOIN_ACCURACY_FACTOR));
    if (cur.length) {
      const center: LatLon = [sumLat / cur.length, sumLon / cur.length];
      if (haversineM(center, [p.lat, p.lon]) <= joinR) {
        cur.push(i);
        sumLat += p.lat;
        sumLon += p.lon;
        continue;
      }
      groups.push(cur);
    }
    cur = [i];
    sumLat = p.lat;
    sumLon = p.lon;
  }
  if (cur.length) groups.push(cur);

  // Merge jitter first, then groups that still last under MIN_STAY_MS go back to being moving points.
  const merged = mergeJitter(groups, pts).flatMap((g) =>
    g.length >= 2 && pts[g[g.length - 1]].t - pts[g[0]].t < MIN_STAY_MS ? g.map((i) => [i]) : [g],
  );

  const stays: Stay[] = [];
  const nodes: Node[] = merged.map((g) => {
    if (g.length === 1) return { pos: [pts[g[0]].lat, pts[g[0]].lon], stay: null };
    const center: LatLon = [g.reduce((s, i) => s + pts[i].lat, 0) / g.length, g.reduce((s, i) => s + pts[i].lon, 0) / g.length];
    const dists = g.map((i) => haversineM(center, [pts[i].lat, pts[i].lon])).sort((a, b) => a - b);
    const stay: Stay = {
      center,
      radiusM: Math.max(MIN_STAY_RADIUS_M, dists[Math.floor(dists.length * 0.8)] ?? 0),
      start: pts[g[0]].t,
      end: pts[g[g.length - 1]].t,
      indices: g,
    };
    stays.push(stay);
    return { pos: center, stay };
  });
  if (endAt && nodes.length) nodes[nodes.length - 1].pos = endAt;

  // Split into trips: from one stay (or the start) to the next stay (or the end).
  const paths: LatLon[][] = [];
  let run: LatLon[] = [nodes[0].pos];
  const flush = () => {
    if (run.length === 2) paths.push(arc(run[0], run[1]));
    else if (run.length > 2) paths.push(spline(run));
  };
  for (let k = 1; k < nodes.length; k++) {
    run.push(nodes[k].pos);
    if (nodes[k].stay) {
      flush();
      run = [nodes[k].pos];
    }
  }
  flush();

  const spikeStubs: [LatLon, LatLon][] = [...spikeIndices].map((i) => [
    [pts[i - 1].lat, pts[i - 1].lon],
    [pts[i].lat, pts[i].lon],
  ]);

  return { paths, spikeStubs, stays, spikeIndices };
}
