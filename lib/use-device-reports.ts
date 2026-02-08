"use client";

import useSWR from "swr";
import { getReportsForDevice } from "./get-reports";
import type { Device, DeviceReport } from "./types";

export function useDeviceReports(
  device: Device | undefined,
  apiURL: string,
  username: string,
  password: string,
  days: number
) {
  return useSWR<DeviceReport[]>(
    device && apiURL ? ["deviceReports", device.id, days] : null,
    async () => {
      if (!device) throw new Error("Device is required");
      return getReportsForDevice(device, apiURL, username, password, days);
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      refreshInterval: 300_000,
    }
  );
}
