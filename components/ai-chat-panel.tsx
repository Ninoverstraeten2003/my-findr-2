"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Square, Trash2, Wrench, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/jev";
import { sendChat, type ChatMessage } from "@/lib/ai-chat";
import { CHAT_MODELS } from "@/lib/ai-chat-models";
import type { AiPath, ToolContext } from "@/lib/ai-tools";
import type { AiChatConfig } from "@/lib/use-ai-chat-config";
import type { Device } from "@/lib/types";

type Shown =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; text: string; failed?: boolean }
  | { kind: "note"; text: string; error?: boolean };

interface AiChatPanelProps {
  devices: Device[];
  currentDevice?: Device;
  config: AiChatConfig;
  onSpend: (usd: number) => void;
  authHeaders: Record<string, string>;
  hasKey: boolean;
  loadReports: ToolContext["loadReports"];
  aiPath: AiPath | null;
  onDrawPath: (path: AiPath | null) => void;
  onOpenSettings: () => void;
}

/** Minimal formatting for model answers: **bold** and "- " bullets, rendered as React text (no HTML). */
function Formatted({ text }: { text: string }) {
  const lines = text.split("\n");
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
    );
  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, i) => {
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span aria-hidden>•</span>
              <span>{inline(bullet[1])}</span>
            </div>
          );
        }
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) return <strong key={i}>{inline(heading[1])}</strong>;
        return line.trim() ? <p key={i}>{inline(line)}</p> : <div key={i} className="h-1" />;
      })}
    </div>
  );
}

export default function AiChatPanel({
  devices,
  currentDevice,
  config,
  onSpend,
  authHeaders,
  hasKey,
  loadReports,
  aiPath,
  onDrawPath,
  onOpenSettings,
}: AiChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [shown, setShown] = useState<Shown[]>([]);
  const [busy, setBusy] = useState(false);
  const [chatCost, setChatCost] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shown, busy]);

  const modelLabel = CHAT_MODELS.find((m) => m.id === config.model)?.label ?? config.model;
  const exampleDevice = currentDevice?.name ?? devices[0]?.name ?? "my tag";
  const suggestions = useMemo(
    () => [
      `What did ${exampleDevice} do today?`,
      `Explain yesterday for ${exampleDevice}`,
      `Draw the route of ${exampleDevice}'s last trip`,
    ],
    [exampleDevice],
  );

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setShown((s) => [...s, { kind: "user", text: q }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await sendChat({
        history: [...history, { role: "user", content: q }],
        model: config.model,
        authHeaders,
        budgetUsd: config.maxCostPerChatUsd,
        spentUsd: chatCost,
        signal: controller.signal,
        ctx: {
          devices,
          loadReports,
          drawPath: (p) => {
            onDrawPath(p);
            if (p) setOpen(false); // show the map
          },
        },
        onEvent: (e) => {
          if (e.type === "tool") setShown((s) => [...s, { kind: "tool", text: e.summary, failed: e.failed }]);
          if (e.type === "cost") {
            setChatCost((c) => c + e.usd);
            onSpend(e.usd);
          }
        },
      });
      setHistory(result.history);
      const last = result.history[result.history.length - 1];
      if (last?.role === "assistant" && last.content) setShown((s) => [...s, { kind: "assistant", text: last.content! }]);
      if (result.stopped) setShown((s) => [...s, { kind: "note", text: result.stopped! }]);
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      setShown((s) => [...s, { kind: "note", text: aborted ? "Stopped." : e instanceof Error ? e.message : String(e), error: !aborted }]);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setHistory([]);
    setShown([]);
    setChatCost(0);
  };

  if (!config.enabled) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-[4.25rem] right-4 z-[1000] flex items-center gap-1.5 rounded-full border border-border bg-card/30 px-3 py-2 text-xs font-medium text-card-foreground shadow-md backdrop-blur-md touch-none active:scale-95 transition-transform"
        aria-label="Ask the AI about your tags"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
        <span>Ask</span>
      </button>

      <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[85dvh] md:max-w-lg md:mx-auto">
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4" /> Ask about your tags
            </DrawerTitle>
            <DrawerDescription className="text-xs">
              {modelLabel} via OpenRouter, no data kept by the provider · this chat {formatUsd(chatCost)} of $
              {config.maxCostPerChatUsd}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex min-h-[30dvh] flex-col gap-2 overflow-y-auto px-4 pb-2 text-sm">
            {!hasKey && (
              <p className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                Add your OpenRouter key (or the owner token) in Settings first.{" "}
                <button
                  className="underline"
                  onClick={() => {
                    setOpen(false);
                    onOpenSettings();
                  }}
                >
                  Open Settings
                </button>
              </p>
            )}
            {shown.length === 0 && (
              <div className="flex flex-col gap-2 py-2">
                <p className="text-xs text-muted-foreground">
                  The AI reads your decrypted reports through tools in this browser and can draw a path on the map. It
                  sends report coordinates to the model provider, with zero data retention.
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      disabled={!hasKey}
                      className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {shown.map((m, i) =>
              m.kind === "user" ? (
                <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-3 py-2 text-background">
                  {m.text}
                </div>
              ) : m.kind === "assistant" ? (
                <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-sm bg-secondary px-3 py-2">
                  <Formatted text={m.text} />
                </div>
              ) : m.kind === "tool" ? (
                <div key={i} className={cn("flex items-center gap-1.5 text-xs", m.failed ? "text-destructive" : "text-muted-foreground")}>
                  <Wrench className="h-3 w-3 shrink-0" />
                  {m.text}
                </div>
              ) : (
                <p key={i} className={cn("text-xs", m.error ? "text-destructive" : "text-muted-foreground")}>
                  {m.text}
                </p>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex flex-col gap-2 border-t border-border px-4 pb-4 pt-3">
            {(aiPath || shown.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {aiPath && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onDrawPath(null)}>
                    <Eraser className="h-3 w-3" /> Clear drawn path
                  </Button>
                )}
                {shown.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={reset}>
                    <Trash2 className="h-3 w-3" /> New chat
                  </Button>
                )}
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                rows={1}
                placeholder="Ask where a tag went…"
                disabled={!hasKey}
                className="min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              />
              {busy ? (
                <Button type="button" size="icon" variant="outline" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" size="icon" disabled={!input.trim() || !hasKey} aria-label="Send">
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </form>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
