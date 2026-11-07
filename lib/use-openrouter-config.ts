"use client";

import { useCallback, useEffect, useState } from "react";

/** How the AI chat is paid for: the user's own OpenRouter key, or the site owner's token for the shared key. */
export interface OpenRouterConfig {
  userApiKey: string;
  accessToken: string;
}

const DEFAULT: OpenRouterConfig = { userApiKey: "", accessToken: "" };
const STORAGE_KEY = "findr-openrouter";
const EVENT = "openrouter-config-updated";
/** Jev (removed) kept the key in its own settings, plus a label cache: moved over / cleared once. */
const OLD_JEV_KEYS = ["findr-jev-config", "findr-jev-cache-v2", "findr-jev-cache-v1"];

function load(): OpenRouterConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const config: OpenRouterConfig = raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT };
    const old = localStorage.getItem(OLD_JEV_KEYS[0]);
    if (!old) return config;
    // Fill in what's still empty from the old Jev settings, then drop those and Jev's label cache.
    const jev = JSON.parse(old);
    if (!config.userApiKey && typeof jev.userApiKey === "string") config.userApiKey = jev.userApiKey;
    if (!config.accessToken && typeof jev.accessToken === "string") config.accessToken = jev.accessToken;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    for (const k of OLD_JEV_KEYS) localStorage.removeItem(k);
    return config;
  } catch {
    return DEFAULT;
  }
}

export function useOpenRouterConfig(): [
  OpenRouterConfig,
  (u: OpenRouterConfig | ((c: OpenRouterConfig) => OpenRouterConfig)) => void,
] {
  const [config, setConfig] = useState<OpenRouterConfig>(DEFAULT);

  useEffect(() => {
    setConfig(load());
    const reload = () => setConfig(load());
    window.addEventListener(EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const update = useCallback((u: OpenRouterConfig | ((c: OpenRouterConfig) => OpenRouterConfig)) => {
    const next = typeof u === "function" ? u(load()) : u;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* memory only */
    }
    setConfig(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [config, update];
}

/** Headers /api/chat reads to pick the key (lib/server/openrouter-auth.ts). */
export function openRouterAuthHeaders(config: OpenRouterConfig): Record<string, string> {
  return config.userApiKey.trim()
    ? { "x-openrouter-key": config.userApiKey.trim() }
    : { "x-owner-token": config.accessToken };
}
