"use client";

import { useState, useCallback, useEffect } from "react";
import type { AppSettings } from "./types";

const STORAGE_KEY = "findmy-settings";

export const defaultSettings: AppSettings = {
  apiURL: "",
  username: "",
  password: "",
  days: 1,
  showHistory: true,
  mapTheme: "system",
  devices: [],
};


function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    return JSON.parse(raw) as AppSettings;
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: AppSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useSettings(): [
  AppSettings,
  (s: AppSettings) => void,
  () => void,
] {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    const handleUrlSettings = async () => {
      if (typeof window === "undefined") return;

      const searchParams = new URLSearchParams(window.location.search);
      const dataParam = searchParams.get("data");
      
      // Also check if there is a hash for the key
      // Hash format: #key=... or just #... if we want to be flexible, but we use #key=
      // We can use URLSearchParams on the hash substring
      let keyParam: string | null = null;
      if (window.location.hash) {
        // remove leading #
        const hash = window.location.hash.substring(1); 
        const hashParams = new URLSearchParams(hash);
        keyParam = hashParams.get("key");
      }

      if (dataParam && keyParam) {
        try {
          const { decryptSettings } = await import("@/lib/secure-share");
          const parsed = await decryptSettings(dataParam, keyParam);
          
          // Basic validation
          if (parsed && typeof parsed === "object") {
             // Merge with default settings
             const newSettings = { ...defaultSettings, ...parsed };
             setSettings(newSettings);
             saveSettings(newSettings);
             
             // Clean up URL (remove query and hash)
             const newUrl = window.location.pathname;
             window.history.replaceState({}, "", newUrl);
             return;
          }
        } catch (e) {
          console.error("Failed to decrypt settings from URL", e);
        }
      }
      
      // If we didn't return above (no URL settings or failed), load from storage
      setSettings(loadSettings());
    };

    handleUrlSettings();
  }, []);

  const update = useCallback((s: AppSettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const clear = useCallback(() => {
    setSettings(defaultSettings);
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return [settings, update, clear];
}
