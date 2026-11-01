"use client";

import { useCallback, useRef, useState } from "react";
import { sendChat, type ChatMessage } from "./ai-chat";
import type { ToolContext } from "./ai-tools";

export type ShownItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; text: string; failed?: boolean }
  | { kind: "note"; text: string; error?: boolean };

/**
 * One chat conversation. Lives in the always-mounted AI panel, so closing the sheet doesn't lose it.
 */
export function useAiChatSession(opts: {
  model: string;
  budgetUsd: number;
  authHeaders: Record<string, string>;
  ctx: ToolContext;
  onSpend: (usd: number) => void;
}) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [shown, setShown] = useState<ShownItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Latest options without re-creating ask() on every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      const o = optsRef.current;
      setBusy(true);
      setShown((s) => [...s, { kind: "user", text: q }]);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await sendChat({
          history: [...history, { role: "user", content: q }],
          model: o.model,
          authHeaders: o.authHeaders,
          budgetUsd: o.budgetUsd,
          spentUsd: cost,
          signal: controller.signal,
          ctx: o.ctx,
          onEvent: (e) => {
            if (e.type === "tool") setShown((s) => [...s, { kind: "tool", text: e.summary, failed: e.failed }]);
            if (e.type === "cost") {
              setCost((c) => c + e.usd);
              optsRef.current.onSpend(e.usd);
            }
          },
        });
        setHistory(result.history);
        const last = result.history[result.history.length - 1];
        if (last?.role === "assistant" && last.content) setShown((s) => [...s, { kind: "assistant", text: last.content! }]);
        if (result.stopped) setShown((s) => [...s, { kind: "note", text: result.stopped! }]);
      } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        setShown((s) => [
          ...s,
          { kind: "note", text: aborted ? "Stopped." : e instanceof Error ? e.message : String(e), error: !aborted },
        ]);
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, history, cost],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setHistory([]);
    setShown([]);
    setCost(0);
  }, []);

  return { shown, busy, cost, ask, stop, reset };
}

export type AiChatSession = ReturnType<typeof useAiChatSession>;
