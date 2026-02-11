import { TierLimits } from "./types";

export const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    maxDevices: 2,
    maxIngestionsPerHour: 24,
    retentionDays: 30,
  },
  pro: {
    maxDevices: 10,
    maxIngestionsPerHour: 120,
    retentionDays: 180,
  },
  unlimited: {
    maxDevices: 100,
    maxIngestionsPerHour: 3000,
    retentionDays: 365,
  },
};
