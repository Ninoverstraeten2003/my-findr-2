// Tools the AI chat can call. They run in the browser, on reports decrypted here; the model only gets
// their results. Paths are always built from real reports (optionally following roads), never invented.

import { buildTrail } from "./trail";
import { classifyReports } from "./report-quality";
import type { Device, DeviceReport } from "./types";

export type TravelMode = "car" | "bike" | "foot" | "train" | "unknown";

export interface AiPathLeg {
  coords: [number, number][];
  mode: TravelMode;
  label: string;
  routed: boolean;
}

export interface AiPath {
  title: string;
  legs: AiPathLeg[];
}

export interface ToolContext {
  devices: Device[];
  /** Reports of a device seen between from and to, decrypted and sorted by seen time. */
  loadReports: (device: Device, from: Date, to: Date) => Promise<DeviceReport[]>;
  drawPath: (path: AiPath | null) => void;
}

// ── Schemas (OpenAI-style function tools, as OpenRouter expects) ──────────────────────────────

const timeParam = (what: string) => ({
  type: "string",
  description: `${what}, local time as "YYYY-MM-DD HH:MM" (or just "YYYY-MM-DD")`,
});

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_devices",
      description: "List the user's tracker tags (devices) by name.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_latest",
      description:
        "Last report of each device (or one device): when it was seen, how long ago, where, accuracy and confidence. Use for \"where is it now\" questions. With oldest, also the first report ever stored and the total count (loads the whole history, slower).",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string", description: "Leave out for all devices" },
          oldest: { type: "boolean", description: "Also return the oldest stored report" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stays_and_trips",
      description:
        "Summarise where a device stayed and the trips between stays in a time range, with durations, average trip speed and the periods without any report. Start here for questions about a day or a period.",
      parameters: {
        type: "object",
        properties: { device: { type: "string" }, from: timeParam("Start"), to: timeParam("End") },
        required: ["device", "from", "to"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reports",
      description:
        "Raw location reports of a device in a time range: time, lat, lon, accuracy (m), Apple confidence (1-3) and quality (reliable / approximate / doubtful, the same levels the map shows). If the range has more than max_rows reports, the rows are evenly spaced over them and always include the first and the last report of the range; first_in_range / last_in_range give those times too.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string" },
          from: timeParam("Start"),
          to: timeParam("End"),
          max_rows: { type: "integer", description: "Default 150, at most 400" },
        },
        required: ["device", "from", "to"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_name",
      description: "Name of the place at a coordinate (street, area, town) from OpenStreetMap.",
      parameters: {
        type: "object",
        properties: { lat: { type: "number" }, lon: { type: "number" } },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_place",
      description:
        "Coordinates of a named place or address (OpenStreetMap search), e.g. to check when a device was there with visits_near.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Place name or address, with the town if known" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "visits_near",
      description:
        "When a device was near a point in a time range: each visit is a run of reports within radius_m of the point, ended by a report outside it (single-report jumps are skipped). Gives start, end, report count and the longest gap between reports.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string" },
          lat: { type: "number" },
          lon: { type: "number" },
          radius_m: { type: "integer", description: "Default 150, between 20 and 5000" },
          from: timeParam("Start"),
          to: timeParam("End"),
        },
        required: ["device", "lat", "lon", "from", "to"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "route",
      description:
        "Road route through points (in order) for car, bike or foot: distance and typical travel time. Useful to judge the travel mode of a trip.",
      parameters: {
        type: "object",
        properties: {
          points: {
            type: "array",
            minItems: 2,
            maxItems: 25,
            items: {
              type: "object",
              properties: { lat: { type: "number" }, lon: { type: "number" } },
              required: ["lat", "lon"],
              additionalProperties: false,
            },
          },
          mode: { type: "string", enum: ["car", "bike", "foot"] },
        },
        required: ["points", "mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draw_path",
      description:
        "Draw how the device moved on the map, as legs between times. Each leg is drawn through the device's real reports in that time range; with follow_roads it follows roads for car, bike or foot. Replaces any earlier drawn path.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string" },
          title: { type: "string" },
          legs: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                from: timeParam("Leg start"),
                to: timeParam("Leg end"),
                mode: { type: "string", enum: ["car", "bike", "foot", "train", "unknown"] },
                follow_roads: { type: "boolean" },
              },
              required: ["from", "to", "mode", "follow_roads"],
              additionalProperties: false,
            },
          },
        },
        required: ["device", "legs"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_path",
      description: "Remove the path drawn by draw_path from the map.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

export function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses "YYYY-MM-DD HH:MM" / "YYYY-MM-DD" as local time, or any ISO string. */
export function parseTime(value: unknown, endOfDay = false): Date {
  if (typeof value !== "string") throw new Error("time missing");
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    if (h === undefined) {
      return endOfDay ? new Date(+y, +mo - 1, +d, 23, 59, 59) : new Date(+y, +mo - 1, +d, 0, 0, 0);
    }
    return new Date(+y, +mo - 1, +d, +h, +mi);
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`can't read time "${value}"`);
  return new Date(t);
}

function findDevice(ctx: ToolContext, name: unknown): Device {
  const wanted = String(name ?? "").trim().toLowerCase();
  const device =
    ctx.devices.find((d) => d.name.toLowerCase() === wanted) ??
    ctx.devices.find((d) => d.name.toLowerCase().includes(wanted));
  if (!device) throw new Error(`no device called "${name}"; known: ${ctx.devices.map((d) => d.name).join(", ")}`);
  return device;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const minutesBetween = (a: number, b: number) => Math.round((b - a) / 60_000);
/** Periods without any report that are at least this long are listed, so the model doesn't fill them in. */
const GAP_MIN = 60;
const MAX_GAPS = 40;
const pos = (r: DeviceReport): [number, number] => [r.decrypedPayload.location.latitude, r.decrypedPayload.location.longitude];
const time = (r: DeviceReport) => new Date(r.decrypedPayload.date);

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

// OpenStreetMap services: public, so be gentle (cache, and at most 1 Nominatim request per second).
const placeCache = new Map<string, unknown>();
let lastNominatim = 0;

async function nominatim(path: string) {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetch(`https://nominatim.openstreetmap.org/${path}`);
  if (!res.ok) throw new Error(`place lookup failed (${res.status})`);
  return res.json();
}

async function placeName(lat: number, lon: number) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const d = await nominatim(`reverse?format=jsonv2&zoom=17&accept-language=en&lat=${lat}&lon=${lon}`);
  const a = d.address ?? {};
  const result = {
    name: d.name || undefined,
    street: [a.road, a.house_number].filter(Boolean).join(" ") || undefined,
    area: a.suburb || a.neighbourhood || a.quarter || undefined,
    town: a.city || a.town || a.village || a.municipality || undefined,
    country: a.country_code?.toUpperCase(),
    kind: d.type || d.category,
  };
  placeCache.set(key, result);
  return result;
}

async function findPlace(query: string) {
  const key = `q:${query.toLowerCase()}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const d = (await nominatim(
    `search?format=jsonv2&limit=5&accept-language=en&q=${encodeURIComponent(query)}`,
  )) as { display_name: string; lat: string; lon: string; type?: string; category?: string }[];
  const result = d.map((p) => ({ name: p.display_name, lat: r5(+p.lat), lon: r5(+p.lon), kind: p.type || p.category }));
  placeCache.set(key, result);
  return result;
}

const OSRM_PROFILE: Record<"car" | "bike" | "foot", string> = { car: "car", bike: "bike", foot: "foot" };

async function osrmRoute(points: [number, number][], mode: "car" | "bike" | "foot") {
  const coords = points.map(([la, lo]) => `${lo},${la}`).join(";");
  const res = await fetch(
    `https://routing.openstreetmap.de/routed-${OSRM_PROFILE[mode]}/route/v1/driving/${coords}?overview=full&geometries=geojson`,
  );
  if (!res.ok) throw new Error(`routing failed (${res.status})`);
  const d = await res.json();
  const r = d.routes?.[0];
  if (!r) throw new Error("no route found");
  return {
    distanceKm: r.distance / 1000,
    durationMin: r.duration / 60,
    geometry: (r.geometry.coordinates as [number, number][]).map(([lo, la]) => [la, lo] as [number, number]),
  };
}

/** Distance in metres from a point to a polyline (local flat approximation, fine at these scales). */
function distToPolylineM(p: [number, number], line: [number, number][]): number {
  const kx = 111_320 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110_540;
  const xy = (q: [number, number]) => [(q[1] - p[1]) * kx, (q[0] - p[0]) * ky];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = xy(line[i - 1]);
    const [bx, by] = xy(line[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** How far a report may sit off the drawn road path (beyond its own accuracy) before it becomes a via point. */
const OFF_ROUTE_M = 400;
const MAX_VIAS = 3;

/**
 * Road path from the first to the last point. Routing through every (noisy) report makes detours, so start
 * with the direct route and only add a report as a via point when it lies clearly off that route.
 */
async function roadPathThrough(points: { p: [number, number]; acc: number }[], mode: "car" | "bike" | "foot") {
  const first = points[0];
  const last = points[points.length - 1];
  const vias: number[] = [];
  let route = await osrmRoute([first.p, last.p], mode);
  for (let round = 0; round < MAX_VIAS; round++) {
    let worst = -1;
    let worstOff = OFF_ROUTE_M;
    points.forEach((pt, i) => {
      if (i === 0 || i === points.length - 1 || vias.includes(i)) return;
      const off = distToPolylineM(pt.p, route.geometry) - pt.acc;
      if (off > worstOff) {
        worstOff = off;
        worst = i;
      }
    });
    if (worst < 0) break;
    vias.push(worst);
    vias.sort((a, b) => a - b);
    route = await osrmRoute([first.p, ...vias.map((i) => points[i].p), last.p], mode);
  }
  return { ...route, vias: vias.length };
}

// ── Execution ─────────────────────────────────────────────────────────────────────────────

/** Runs one tool call; returns a JSON-able result and a short human line for the chat log. */
export async function runTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<{ result: unknown; summary: string }> {
  switch (name) {
    case "list_devices":
      return { result: { devices: ctx.devices.map((d) => d.name) }, summary: "Listed your devices" };

    case "get_latest": {
      const devices = args.device ? [findDevice(ctx, args.device)] : ctx.devices;
      const now = Date.now();
      const oldest = !!args.oldest;
      const facts = (r: DeviceReport) => {
        const p = r.decrypedPayload;
        return {
          time: formatLocal(time(r)),
          lat: r5(p.location.latitude),
          lon: r5(p.location.longitude),
          accuracy_m: p.location.accuracy,
          confidence: p.confidence,
        };
      };
      const latest = await Promise.all(
        devices.map(async (device) => {
          if (oldest) {
            // Whole history: Find My times start in 2001, so nothing can be older.
            const all = await ctx.loadReports(device, new Date(2001, 0, 1), new Date(now));
            if (all.length === 0) return { device: device.name, seen: "no reports stored" };
            const last = all[all.length - 1];
            return {
              device: device.name,
              total_reports: all.length,
              oldest: facts(all[0]),
              latest: { ...facts(last), minutes_ago: minutesBetween(time(last).getTime(), now) },
            };
          }
          // Look back further only when nothing turned up, so the usual case loads one day.
          for (const days of [1, 7, 30]) {
            const reports = await ctx.loadReports(device, new Date(now - days * 86_400_000), new Date(now));
            const r = reports[reports.length - 1];
            if (!r) continue;
            return {
              device: device.name,
              ...facts(r),
              minutes_ago: minutesBetween(time(r).getTime(), now),
              reports_last_24h: reports.filter((x) => now - time(x).getTime() <= 86_400_000).length,
            };
          }
          return { device: device.name, seen: "no report in the last 30 days" };
        }),
      );
      const who = devices.length === 1 ? devices[0].name : "every device";
      return {
        result: { latest },
        summary: oldest ? `Read the oldest and latest report of ${who}` : `Read the latest report of ${who}`,
      };
    }

    case "find_place": {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query missing");
      const results = await findPlace(query);
      return { result: { results }, summary: `Searched for "${query}"` };
    }

    case "visits_near": {
      const device = findDevice(ctx, args.device);
      const center: [number, number] = [Number(args.lat), Number(args.lon)];
      if (!center.every(Number.isFinite)) throw new Error("lat/lon missing");
      const radius = Math.min(5000, Math.max(20, Number(args.radius_m) || 150));
      const reports = await ctx.loadReports(device, parseTime(args.from), parseTime(args.to, true));
      const trail = buildTrail(
        reports.map((r) => ({ lat: pos(r)[0], lon: pos(r)[1], acc: r.decrypedPayload.location.accuracy, t: time(r).getTime() })),
      );
      const visits: { start: string; end: string; minutes: number; reports: number; closest_m: number; longest_gap_min: number }[] = [];
      let run: DeviceReport[] = [];
      let closest = Infinity;
      const flush = () => {
        if (run.length) {
          let gap = 0;
          for (let k = 1; k < run.length; k++) gap = Math.max(gap, minutesBetween(time(run[k - 1]).getTime(), time(run[k]).getTime()));
          visits.push({
            start: formatLocal(time(run[0])),
            end: formatLocal(time(run[run.length - 1])),
            minutes: minutesBetween(time(run[0]).getTime(), time(run[run.length - 1]).getTime()),
            reports: run.length,
            closest_m: Math.round(closest),
            longest_gap_min: gap,
          });
        }
        run = [];
        closest = Infinity;
      };
      reports.forEach((r, i) => {
        if (trail.spikeIndices.has(i)) return;
        const d = haversineM(center, pos(r));
        if (d <= radius) {
          run.push(r);
          closest = Math.min(closest, d);
        } else flush();
      });
      flush();
      return {
        result: { device: device.name, radius_m: radius, reports_in_range: reports.length, visits: visits.slice(0, 60), more_visits: Math.max(0, visits.length - 60) },
        summary: `Found ${visits.length} visit${visits.length === 1 ? "" : "s"} of ${device.name} near that point`,
      };
    }

    case "get_reports": {
      const device = findDevice(ctx, args.device);
      const from = parseTime(args.from);
      const to = parseTime(args.to, true);
      const reports = await ctx.loadReports(device, from, to);
      const max = Math.min(400, Math.max(10, Number(args.max_rows) || 150));
      // Classified over every report in the range (it looks at neighbours), then sampled.
      const quality = classifyReports(
        reports.map((r) => ({ lat: pos(r)[0], lon: pos(r)[1], acc: r.decrypedPayload.location.accuracy, t: time(r).getTime(), confidence: r.decrypedPayload.confidence })),
      );
      const rows = sampleEvenly(reports.map((r, i) => ({ r, q: quality[i] })), max).map(({ r, q }) => {
        const p = r.decrypedPayload;
        return `${formatLocal(time(r))},${r5(p.location.latitude)},${r5(p.location.longitude)},${p.location.accuracy},${p.confidence},${q.level}`;
      });
      const sampled = rows.length < reports.length;
      return {
        result: {
          device: device.name,
          total_reports: reports.length,
          shown: rows.length,
          ...(reports.length
            ? { first_in_range: formatLocal(time(reports[0])), last_in_range: formatLocal(time(reports[reports.length - 1])) }
            : {}),
          rows_are: sampled ? "evenly spaced, including the first and last report of the range" : "every report in the range",
          columns: "time,lat,lon,accuracy_m,confidence,quality",
          rows: rows.join("\n"),
        },
        // Say how many rows the model actually got, not only how many exist.
        summary: sampled
          ? `Read ${rows.length} of ${reports.length.toLocaleString()} reports of ${device.name} (evenly spaced)`
          : `Read ${reports.length.toLocaleString()} report${reports.length === 1 ? "" : "s"} of ${device.name}`,
      };
    }

    case "get_stays_and_trips": {
      const device = findDevice(ctx, args.device);
      const from = parseTime(args.from);
      const to = parseTime(args.to, true);
      const reports = await ctx.loadReports(device, from, to);
      if (reports.length === 0) {
        return { result: { device: device.name, reports: 0 }, summary: `No reports of ${device.name} in that range` };
      }
      const trail = buildTrail(
        reports.map((r) => ({ lat: pos(r)[0], lon: pos(r)[1], acc: r.decrypedPayload.location.accuracy, t: time(r).getTime() })),
      );
      const stays = trail.stays.map((s) => ({
        start: formatLocal(new Date(s.start)),
        end: formatLocal(new Date(s.end)),
        lat: r5(s.center[0]),
        lon: r5(s.center[1]),
        minutes: minutesBetween(s.start, s.end),
        radius_m: Math.round(s.radiusM),
        reports: s.indices.length,
      }));
      // Trips: from the last report of one stay to the first of the next (or from the first / to the last report),
      // so their times, distance and speed cover the whole move, not only the reports seen while moving.
      const inStay = new Set(trail.stays.flatMap((s) => s.indices));
      const trips: unknown[] = [];
      let run: number[] = [];
      let moving = 0;
      let lastStay = -1;
      const flush = (endStay?: number) => {
        if (moving > 0) {
          const pts = (endStay === undefined ? run : [...run, endStay]).map((i) => reports[i]);
          let km = 0;
          for (let k = 1; k < pts.length; k++) km += haversineM(pos(pts[k - 1]), pos(pts[k])) / 1000;
          const minutes = minutesBetween(time(pts[0]).getTime(), time(pts[pts.length - 1]).getTime());
          trips.push({
            from: formatLocal(time(pts[0])),
            to: formatLocal(time(pts[pts.length - 1])),
            minutes,
            reports_while_moving: moving,
            path_km: Math.round(km * 10) / 10,
            ...(minutes > 0 ? { avg_kmh: Math.round((km / minutes) * 60) } : {}),
            straight_km: Math.round((haversineM(pos(pts[0]), pos(pts[pts.length - 1])) / 1000) * 10) / 10,
          });
        }
        run = [];
        moving = 0;
      };
      reports.forEach((_, i) => {
        if (trail.spikeIndices.has(i)) return;
        if (inStay.has(i)) {
          flush(i);
          lastStay = i;
        } else {
          if (run.length === 0 && lastStay >= 0) run.push(lastStay);
          run.push(i);
          moving++;
        }
      });
      flush();
      const spikes = [...trail.spikeIndices].map((i) => ({
        time: formatLocal(time(reports[i])),
        lat: r5(pos(reports[i])[0]),
        lon: r5(pos(reports[i])[1]),
        accuracy_m: reports[i].decrypedPayload.location.accuracy,
        confidence: reports[i].decrypedPayload.confidence,
      }));
      const gaps: { from: string; to: string; minutes: number }[] = [];
      for (let i = 1; i < reports.length && gaps.length < MAX_GAPS; i++) {
        const minutes = minutesBetween(time(reports[i - 1]).getTime(), time(reports[i]).getTime());
        if (minutes >= GAP_MIN) gaps.push({ from: formatLocal(time(reports[i - 1])), to: formatLocal(time(reports[i])), minutes });
      }
      return {
        result: {
          device: device.name,
          reports: reports.length,
          first: formatLocal(time(reports[0])),
          last: formatLocal(time(reports[reports.length - 1])),
          stays,
          trips,
          single_report_jumps: spikes,
          [`no_reports_for_${GAP_MIN}_min_or_more`]: gaps,
        },
        summary: `Summarised ${device.name}: ${stays.length} stays, ${trips.length} trips`,
      };
    }

    case "place_name": {
      const lat = Number(args.lat);
      const lon = Number(args.lon);
      const place = await placeName(lat, lon);
      return { result: place, summary: "Looked up a place name" };
    }

    case "route": {
      const points = (args.points as { lat: number; lon: number }[]).map((p) => [p.lat, p.lon] as [number, number]);
      const r = await osrmRoute(points, args.mode);
      return {
        result: { mode: args.mode, distance_km: Math.round(r.distanceKm * 10) / 10, typical_minutes: Math.round(r.durationMin) },
        summary: `Checked a ${args.mode} route`,
      };
    }

    case "draw_path": {
      const device = findDevice(ctx, args.device);
      const legsIn = args.legs as { from: string; to: string; mode: TravelMode; follow_roads: boolean }[];
      const span = legsIn.map((l) => [parseTime(l.from), parseTime(l.to, true)] as const);
      const from = new Date(Math.min(...span.map(([a]) => a.getTime())));
      const to = new Date(Math.max(...span.map(([, b]) => b.getTime())));
      // Load a little around the legs, so each leg can start/end at the report just outside it.
      const reports = await ctx.loadReports(
        device,
        new Date(from.getTime() - 6 * 3_600_000),
        new Date(to.getTime() + 6 * 3_600_000),
      );
      const trail = buildTrail(
        reports.map((r) => ({ lat: pos(r)[0], lon: pos(r)[1], acc: r.decrypedPayload.location.accuracy, t: time(r).getTime() })),
      );

      const legs: AiPathLeg[] = [];
      const report: unknown[] = [];
      for (let k = 0; k < legsIn.length; k++) {
        const [a, b] = span[k];
        const leg = legsIn[k];
        const usable = reports.filter((_, i) => !trail.spikeIndices.has(i));
        const firstIn = usable.findIndex((r) => time(r) >= a);
        let lastIn = -1;
        usable.forEach((r, i) => {
          if (time(r) <= b) lastIn = i;
        });
        // Join up with the stays: start at the last report before the leg and end at the first one after it.
        const startAt = firstIn > 0 ? firstIn - 1 : Math.max(firstIn, 0);
        const endAt = lastIn >= 0 && lastIn < usable.length - 1 ? lastIn + 1 : lastIn;
        const inLeg = firstIn >= 0 && endAt >= startAt ? usable.slice(startAt, endAt + 1) : [];
        if (inLeg.length < 2) {
          report.push({ from: leg.from, to: leg.to, drawn: false, reason: "fewer than 2 reports around this time range" });
          continue;
        }
        let coords = inLeg.map(pos);
        let routed = false;
        let vias = 0;
        if (leg.follow_roads && (leg.mode === "car" || leg.mode === "bike" || leg.mode === "foot")) {
          try {
            const road = await roadPathThrough(
              inLeg.map((r) => ({ p: pos(r), acc: r.decrypedPayload.location.accuracy })),
              leg.mode,
            );
            coords = road.geometry;
            routed = true;
            vias = road.vias;
          } catch {
            /* fall back to the line through the reports */
          }
        }
        let km = 0;
        for (let i = 1; i < coords.length; i++) km += haversineM(coords[i - 1], coords[i]) / 1000;
        const label = `${leg.mode} · ${formatLocal(a).slice(11)}–${formatLocal(b).slice(11)} · ${km.toFixed(1)} km${routed ? " (roads)" : ""}`;
        legs.push({ coords, mode: leg.mode, label, routed });
        report.push({
          from: leg.from,
          to: leg.to,
          drawn: true,
          reports_used: inLeg.length,
          km: Math.round(km * 10) / 10,
          followed_roads: routed,
          ...(routed ? { detour_points_added: vias } : {}),
        });
      }
      ctx.drawPath(legs.length ? { title: String(args.title || `${device.name} path`), legs } : null);
      return { result: { legs: report }, summary: `Drew ${legs.length} leg${legs.length === 1 ? "" : "s"} on the map` };
    }

    case "clear_path":
      ctx.drawPath(null);
      return { result: { cleared: true }, summary: "Cleared the drawn path" };

    default:
      throw new Error(`unknown tool ${name}`);
  }
}
