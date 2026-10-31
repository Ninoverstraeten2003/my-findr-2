// Loads (and decrypts) any device's reports for a time range, for the AI chat tools. Uses the same
// fetch + decrypt path as the map, so the on-device decrypt cache makes repeat lookups fast.

import { getPollerReportsForDevice, getReportsForDevice } from "./get-reports";
import type { AppSettings, Device, DeviceReport } from "./types";

const FRESH_MS = 2 * 60 * 1000;

export function createReportLoader(settings: AppSettings) {
  const cache = new Map<string, { from: number; loadedAt: number; reports: DeviceReport[] }>();

  return async (device: Device, from: Date, to: Date): Promise<DeviceReport[]> => {
    const hit = cache.get(device.id);
    if (!hit || hit.from > from.getTime() || Date.now() - hit.loadedAt > FRESH_MS) {
      const copy = { ...device }; // the fetchers fill in advertismentKey
      const reports =
        settings.usePoller && settings.pollerApiKey
          ? await getPollerReportsForDevice(copy, settings.pollerApiKey, undefined, from.toISOString())
          : await getReportsForDevice(
              copy,
              settings.apiURL,
              settings.username,
              settings.password,
              Math.max(1, Math.ceil((Date.now() - from.getTime()) / 86_400_000) + 1),
            );
      cache.set(device.id, { from: from.getTime(), loadedAt: Date.now(), reports });
    }
    const all = cache.get(device.id)!.reports;
    return all.filter((r) => {
      const t = new Date(r.decrypedPayload.date).getTime();
      return t >= from.getTime() && t <= to.getTime();
    });
  };
}
