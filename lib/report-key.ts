import { hashString } from "./hash";
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
