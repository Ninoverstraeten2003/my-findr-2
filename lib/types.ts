export type BatteryStatus = "Full" | "Medium" | "Low" | "Critical" | "Unknown";

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface DecryptedPayload {
  date: Date;
  confidence: number;
  battery: BatteryStatus;
  location: DeviceLocation;
}

export interface DeviceReport {
  payload: string;
  id: string;
  receivedAt?: string;
  decrypedPayload: DecryptedPayload;
}

export interface Device {
  order: number;
  id: string;
  name: string;
  privateKey: string;
  advertismentKey: string;
  icon: string;
  hexColor: string;
  lastSeen: Date | null;
  battery: BatteryStatus;
}

export interface AppSettings {
  apiURL: string;
  username: string;
  password: string;
  days: number;
  showHistory: boolean;
  showDirectionArrows?: boolean;
  simplifyTrail?: boolean;
  animateTrail?: boolean;
  filterLowQuality?: boolean;
  filterMinConfidence?: number;
  filterMaxAccuracy?: number;
  pollInterval?: number;
  mapTheme: "system" | "light" | "dark" | "satellite" | "streets";
  appTheme: "system" | "light" | "dark";
  usePoller: boolean;
  pollerTier: "free" | "pro" | "unlimited";
  pollerApiKey: string;
  devices: Device[];
}

/** Which reports the map shows: the last N days (settings.days; 9999 = all), or days picked on the calendar
 * (from the start of the first day to the end of the last, local time). */
export type ReportPeriod = { kind: "recent"; days: number } | { kind: "days"; from: Date; to: Date };

export type TierType = "free" | "pro" | "unlimited";

export interface TierLimits {
  maxDevices: number;
  maxIngestionsPerHour: number;
  retentionDays: number;
}
