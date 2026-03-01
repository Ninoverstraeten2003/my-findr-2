"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getReportsForDevice, getPollerReportsForDevice } from "./get-reports";
import type { Device, DeviceReport } from "./types";

export function useDeviceReports(
  device: Device | undefined,
  apiURL: string,
  username: string,
  password: string,
  days: number,
  usePoller: boolean,
  pollerApiKey: string,
  pollerTier: "free" | "pro" | "unlimited" = "free"
) {
  const queryClient = useQueryClient();

  const queryKey = [
    "deviceReports",
    device?.id,
    days,
    username,
    password,
    usePoller,
    pollerApiKey,
    pollerTier,
  ];

  // Always poll every 60s (1 minute).
  const staleTime = 60_000;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!device) throw new Error("Device is required");

      if (usePoller && pollerApiKey) {
        // Delta fetching: check existing cached data
        const existingReports =
          queryClient.getQueryData<DeviceReport[]>(queryKey) || [];

        // Find the latest receivedAt from existing reports
        let after: string | undefined;
        if (existingReports.length > 0) {
          const latestReceivedAt = existingReports.reduce(
            (latest, r) => {
              if (r.receivedAt && r.receivedAt > latest) return r.receivedAt;
              return latest;
            },
            ""
          );
          if (latestReceivedAt) {
            after = latestReceivedAt;
          }
        }

        const newReports = await getPollerReportsForDevice(
          device,
          pollerApiKey,
          after
        );

        if (after && existingReports.length > 0) {
          // Merge: deduplicate by id, then sort by date
          const existingIds = new Set(existingReports.map((r) => r.id));
          const uniqueNew = newReports.filter((r) => !existingIds.has(r.id));

          if (uniqueNew.length === 0) return existingReports;

          return [...existingReports, ...uniqueNew].sort(
            (a, b) =>
              new Date(a.decrypedPayload.date).getTime() -
              new Date(b.decrypedPayload.date).getTime()
          );
        }

        return newReports;
      }

      return getReportsForDevice(device, apiURL, username, password, days);
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
