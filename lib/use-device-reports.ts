"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getReportsForDevice, getPollerReportsForDevice } from "./get-reports";
import type { Device, DeviceReport, ReportPeriod } from "./types";

export function useDeviceReports(
  device: Device | undefined,
  apiURL: string,
  username: string,
  password: string,
  period: ReportPeriod,
  usePoller: boolean,
  pollerApiKey: string,
  pollerTier: "free" | "pro" | "unlimited" = "free",
  pollInterval: number = 60
) {
  const queryClient = useQueryClient();
  const picked = period.kind === "days" ? period : null;
  const days = period.kind === "recent" ? period.days : 0;
  // Picked days that are all in the past can't get new reports seen in them (only late arrivals): no polling.
  const isPast = !!picked && picked.to.getTime() < Date.now() - 3_600_000;

  const queryKey = [
    "deviceReports",
    device?.id,
    picked ? `${picked.from.getTime()}-${picked.to.getTime()}` : days,
    username,
    password,
    usePoller,
    pollerApiKey,
    pollerTier,
    pollInterval,
  ];

  const staleTime = isPast ? Infinity : pollInterval * 1000;
  const inPicked = (r: DeviceReport) => {
    const t = new Date(r.decrypedPayload.date).getTime();
    return !picked || (t >= picked.from.getTime() && t <= picked.to.getTime());
  };

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!device) throw new Error("Device is required");

      if (usePoller && pollerApiKey) {
        // Delta fetching: check existing cached data
        const existingReports =
          queryClient.getQueryData<DeviceReport[]>(queryKey) || [];

        // Find the latest receivedAt from existing reports (cursor for "only new ones")
        let after: string | undefined;
        // History window: reports the tag was SEEN in the last N days
        let seenAfter: string | undefined;
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
        } else {
          // Initial fetch: limit the history by the 'days' setting, on when the tag was seen
          if (days !== 9999) {
            const seenDate = new Date();
            seenDate.setDate(seenDate.getDate() - days);
            seenAfter = seenDate.toISOString();
          }
        }

        // Picked days: every request (the later "only new ones" too) stays inside them.
        const newReports = await getPollerReportsForDevice(
          device,
          pollerApiKey,
          after,
          picked ? picked.from.toISOString() : seenAfter,
          picked ? picked.to.toISOString() : undefined
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

      // The direct API only takes "days back from now": fetch back to the first picked day, keep the picked days.
      const daysBack = picked ? Math.ceil((Date.now() - picked.from.getTime()) / 86_400_000) + 1 : days;
      const all = await getReportsForDevice(device, apiURL, username, password, daysBack);
      return picked ? all.filter(inPicked) : all;
    },
    enabled: !!device && (!!apiURL || (usePoller && !!pollerApiKey)),
    refetchOnWindowFocus: false,
    staleTime,
    refetchInterval: isPast ? false : staleTime,
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
