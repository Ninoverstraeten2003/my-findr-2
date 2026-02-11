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
  mapTheme: "system" | "light" | "dark" | "satellite" | "streets";
  appTheme: "system" | "light" | "dark";
  usePoller: boolean;
  pollerTier: "free" | "pro" | "unlimited";
  pollerApiKey: string;
  devices: Device[];
}

