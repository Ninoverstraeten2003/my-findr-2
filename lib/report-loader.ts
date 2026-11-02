// Loads (and decrypts) any device's reports for a time range, for the AI chat tools. Uses the same
// fetch + decrypt path as the map, so the on-device decrypt cache makes repeat lookups fast.
//  - Own backend (poller): asks only for reports seen in the requested range.
//  - Direct Haystack API: it only takes "days back from now", so it fetches from the start of the range to now.

import { getPollerReportsForDevice, getReportsForDevice } from "./get-reports";
import type { AppSettings, Device, DeviceReport } from "./types";

const FRESH_MS = 2 * 60 * 1000;
/** Margin around the range so the backend's exclusive bounds never cut off a report on the edge. */
const EDGE_MS = 1000;

export function createReportLoader(settings: AppSettings) {
  // Per device: the last fetched range (ms) and its reports. Reused while it covers the request and is fresh.
  const cache = new Map<string, { from: number; to: number; loadedAt: number; reports: DeviceReport[] }>();

  return async (device: Device, from: Date, to: Date): Promise<DeviceReport[]> => {
    const fromMs = from.getTime();
    const toMs = Math.min(to.getTime(), Date.now());
    const hit = cache.get(device.id);
    if (!hit || hit.from > fromMs || hit.to < toMs || Date.now() - hit.loadedAt > FRESH_MS) {
      const copy = { ...device }; // the fetchers fill in advertismentKey
      const usePoller = settings.usePoller && settings.pollerApiKey;
      const reports = usePoller
        ? await getPollerReportsForDevice(
            copy,
            settings.pollerApiKey,
            undefined,
            new Date(fromMs - EDGE_MS).toISOString(),
            new Date(toMs + EDGE_MS).toISOString(),
          )
        : await getReportsForDevice(
            copy,
            settings.apiURL,
            settings.username,
            settings.password,
            Math.max(1, Math.ceil((Date.now() - fromMs) / 86_400_000) + 1),
          );
      cache.set(device.id, { from: fromMs, to: usePoller ? toMs : Date.now(), loadedAt: Date.now(), reports });
    }
    return cache.get(device.id)!.reports.filter((r) => {
      const t = new Date(r.decrypedPayload.date).getTime();
      return t >= fromMs && t <= to.getTime();
    });
  };
}
