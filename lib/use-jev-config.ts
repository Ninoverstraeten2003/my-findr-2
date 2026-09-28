"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_JEV_CONFIG, type JevConfig } from "./jev";

const STORAGE_KEY = "findr-jev-config";
const EVENT = "jev-config-updated";

function loadConfig(): JevConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_JEV_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_JEV_CONFIG;
}

export function useJevConfig(): [JevConfig, (update: JevConfig | ((c: JevConfig) => JevConfig)) => void] {
  const [config, setConfig] = useState<JevConfig>(DEFAULT_JEV_CONFIG);

  useEffect(() => {
    setConfig(loadConfig());
    const reload = () => setConfig(loadConfig());
    window.addEventListener(EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const update = useCallback((u: JevConfig | ((c: JevConfig) => JevConfig)) => {
    // Read the stored value so concurrent updates (e.g. spend tracking during a run) don't overwrite each other.
    const next = typeof u === "function" ? u(loadConfig()) : u;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: keep it in memory */
    }
    setConfig(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [config, update];
}
