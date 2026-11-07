"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Square, Trash2, Wrench, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/format";
import { CHAT_MODELS } from "@/lib/ai-chat-models";
import type { AiPath } from "@/lib/ai-tools";
import type { AiChatConfig } from "@/lib/use-ai-chat-config";
import type { AiChatSession } from "@/lib/use-ai-chat-session";

/** Minimal formatting for model answers: **bold**, headings and "- " bullets, rendered as React text (no HTML). */
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

interface AiChatBodyProps {
  session: AiChatSession;
  config: AiChatConfig;
  hasKey: boolean;
  exampleDevice: string;
  aiPath: AiPath | null;
  onDrawPath: (path: AiPath | null) => void;
  onOpenSettings: () => void;
}

/** The Ask tab of the AI panel. The conversation itself lives in the session (survives closing the sheet). */
export function AiChatBody({ session, config, hasKey, exampleDevice, aiPath, onDrawPath, onOpenSettings }: AiChatBodyProps) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { shown, busy, cost, ask, stop, reset } = session;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shown, busy]);

  const modelLabel = CHAT_MODELS.find((m) => m.id === config.model)?.label ?? config.model;
  const suggestions = useMemo(
    () => [
      `What did ${exampleDevice} do today?`,
      `Which reports of ${exampleDevice} today look like glitches?`,
      `Draw the route of ${exampleDevice}'s last trip`,
    ],
    [exampleDevice],
  );

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");
    void ask(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[30dvh] flex-col gap-2 overflow-y-auto px-4 pb-2 text-sm">
        <p className="text-xs text-muted-foreground">
          {modelLabel} via OpenRouter, no data kept by the provider · this chat {formatUsd(cost)} of $
          {config.maxCostPerChatUsd}
        </p>
        {!hasKey && (
          <p className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            Add your OpenRouter key (or the owner token) in Settings first.{" "}
            <button className="underline" onClick={onOpenSettings}>
              Open Settings
            </button>
          </p>
        )}
        {shown.length === 0 && (
          <div className="flex flex-col gap-2 py-2">
            <p className="text-xs text-muted-foreground">
              The AI reads your decrypted reports through tools in this browser, and can draw a path on
              the map. It sends report coordinates to the model provider, with zero data retention.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
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
            send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask where a tag went…"
            disabled={!hasKey}
            className="min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
          />
          {busy ? (
            <Button type="button" size="icon" variant="outline" onClick={stop} aria-label="Stop">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim() || !hasKey} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
