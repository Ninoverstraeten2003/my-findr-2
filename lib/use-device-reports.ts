"use client";

import { useQuery } from "@tanstack/react-query";
import { getReportsForDevice } from "./get-reports";
import type { Device } from "./types";

export function useDeviceReports(
  device: Device | undefined,
  apiURL: string,
  username: string,
  password: string,
  days: number,
  usePoller: boolean,
  pollerApiKey: string,
  pollerTier: "free" | "pro" | "unlimited" = "free",
  showHistory: boolean
) {
  const queryKey = [
    "deviceReports",
    device?.id,
    days,
    username,
    password,
    usePoller,
    pollerApiKey,
    pollerTier,
    showHistory,
  ];

  // If using Poller, always poll every 60s (1 minute).
  // Otherwise default to 60s for standard backend polling.
  const staleTime = 60_000;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!device) throw new Error("Device is required");
      return getReportsForDevice(
        device,
        apiURL,
        username,
        password,
        days,
        usePoller,
        pollerApiKey,
        showHistory
      );
    },
    enabled: !!device && (!!apiURL || (usePoller && !!pollerApiKey)),
    refetchOnWindowFocus: false,
    staleTime,
    refetchInterval: staleTime,
    retry: (failureCount, error: any) => {
      // Never retry on 404.
      if (error.status === 404) return false;
      // Never retry on 401/403 (Auth).
      if (error.status === 401 || error.status === 403) return false;

      // If using Poller and we get a network error (often status undefined or 0 for CORS), stop.
      if (usePoller && (!error.status || error.status === 0)) return false;

      // Only retry up to 3 times.
      return failureCount < 3;
    },
    retryDelay: 5000,
  });

  return {
    ...query,
    refresh: () => {
      if (query.isStale) {
        query.refetch();
      }
    },
    isValidating: query.isFetching,
    mutate: query.refetch,
  };
}
