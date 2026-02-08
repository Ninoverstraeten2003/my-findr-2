"use client";

import { useRef } from "react";
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
  const lastFetchRef = useRef<number>(0);

  const swrResponse = useSWR<DeviceReport[]>(
    device && apiURL ? ["deviceReports", device.id, days, username, password] : null,
    async () => {
      if (!device) throw new Error("Device is required");
      return getReportsForDevice(device, apiURL, username, password, days);
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      refreshInterval: 300_000,
      onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
        // Never retry on 404.
        if (error.status === 404) return;
        // Never retry on 401/403 (Auth).
        if (error.status === 401 || error.status === 403) return;
        // Only retry up to 10 times.
        if (retryCount >= 10) return;
        // Retry after 5 seconds.
        setTimeout(() => revalidate({ retryCount }), 5000);
      },
      onSuccess: () => {
        lastFetchRef.current = Date.now();
      },
    }
  );

  const refresh = () => {
    const now = Date.now();
    if (now - lastFetchRef.current > 60_000) {
      swrResponse.mutate();
    }
  };

  return { ...swrResponse, refresh };
}
