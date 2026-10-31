"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CHAT_MODEL } from "./ai-chat-models";

export interface AiChatConfig {
  enabled: boolean;
  model: string;
  /** A conversation stops asking the model once it has cost this much. */
  maxCostPerChatUsd: number;
  /** Running total of what OpenRouter reported, kept on this device only. */
  spentUsd: number;
}

export const DEFAULT_AI_CHAT_CONFIG: AiChatConfig = {
  enabled: false,
  model: DEFAULT_CHAT_MODEL,
  maxCostPerChatUsd: 0.05,
  spentUsd: 0,
};

const STORAGE_KEY = "findr-ai-chat-config";
const EVENT = "ai-chat-config-updated";

function load(): AiChatConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_AI_CHAT_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* defaults */
  }
  return DEFAULT_AI_CHAT_CONFIG;
}

export function useAiChatConfig(): [AiChatConfig, (u: AiChatConfig | ((c: AiChatConfig) => AiChatConfig)) => void] {
  const [config, setConfig] = useState<AiChatConfig>(DEFAULT_AI_CHAT_CONFIG);

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

  const update = useCallback((u: AiChatConfig | ((c: AiChatConfig) => AiChatConfig)) => {
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
