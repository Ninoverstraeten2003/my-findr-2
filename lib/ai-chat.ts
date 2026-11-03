// The AI chat loop: one user question may take several model turns while the model calls tools.
// Tools run in the browser (lib/ai-tools.ts); /api/chat only forwards each step to OpenRouter.

import { TOOL_SCHEMAS, formatLocal, runTool, type ToolContext } from "./ai-tools";

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatEvent =
  | { type: "tool"; summary: string; failed?: boolean }
  | { type: "cost"; usd: number };

const MAX_TOOL_ROUNDS = 8;
/** Tool results larger than this are cut, so one call can't blow up the conversation. */
const MAX_TOOL_RESULT_CHARS = 24_000;

function systemPrompt(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    "You help the user understand where their Bluetooth tracker tags (Apple Find My network, OpenHaystack) went.",
    `Now is ${formatLocal(new Date())} local time (${tz}). Use local times as "YYYY-MM-DD HH:MM" in tool calls and answers.`,
    "How the data works: each report is the position of a nearby iPhone that heard the tag, with an accuracy radius in metres and Apple confidence 1-3 (3 best). Reports can be sparse (hours apart, e.g. at night) and some are wrong; a single report far away that the next one contradicts is usually a glitch.",
    "Use the tools instead of guessing. For \"where is it now\" use get_latest; for the oldest or first report use get_latest with oldest. Start with get_stays_and_trips for a day or period; use get_reports for detail, place_name for names of places, route to judge travel mode from distance and time.",
    "For \"when was it at <place>\" use find_place to get coordinates, then visits_near. Periods without reports are unknown: say so instead of filling them in.",
    "get_labels gives Jev classifier labels per report (Consistency 0-3, 0 = likely glitch; Movement). Treat them as hints with their probabilities, not facts; only use run_missing when the user wants labels or the question needs them.",
    "To show movement on the map, call draw_path with legs by time and mode; it draws through the real reports. Never invent coordinates.",
    "Only claim what the tool results show: say which tool and range an answer comes from, and don't describe checks you didn't run.",
    "Say how sure you are and why. Don't claim who carried the tag. Keep answers short; use bullet points for timelines.",
  ].join("\n");
}

export interface SendOptions {
  history: ChatMessage[];
  model: string;
  authHeaders: Record<string, string>;
  ctx: ToolContext;
  budgetUsd: number;
  spentUsd: number;
  onEvent: (e: ChatEvent) => void;
  signal?: AbortSignal;
}

/** Runs the model (and its tool calls) until it answers. Returns the updated history and the cost. */
export async function sendChat(opts: SendOptions): Promise<{ history: ChatMessage[]; costUsd: number; stopped?: string }> {
  const history = [...opts.history];
  let cost = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (opts.spentUsd + cost >= opts.budgetUsd) {
      return { history, costUsd: cost, stopped: `Stopped: this conversation reached its $${opts.budgetUsd} limit` };
    }
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...opts.authHeaders },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "system", content: systemPrompt() }, ...history],
        tools: TOOL_SCHEMAS,
      }),
      signal: opts.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Chat route answered ${res.status}`);

    const step = Number(data.usage?.cost ?? 0);
    cost += step;
    opts.onEvent({ type: "cost", usd: step });

    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error("Empty answer from the model");
    const cutOff = choice.finish_reason === "length";
    const toolCalls: ToolCall[] = msg.tool_calls ?? [];
    history.push({ role: "assistant", content: msg.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    if (toolCalls.length === 0) {
      return { history, costUsd: cost, ...(cutOff ? { stopped: "The answer was cut off at the length limit; ask for a shorter answer or a narrower range" } : {}) };
    }

    if (round === MAX_TOOL_ROUNDS) {
      return { history, costUsd: cost, stopped: "Stopped: too many tool steps for one question" };
    }

    // Answer every tool call (failures included, so the model can recover).
    for (const call of toolCalls) {
      let content: string;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const { result, summary } = await runTool(call.function.name, args, opts.ctx);
        opts.onEvent({ type: "tool", summary });
        content = JSON.stringify(result);
        if (content.length > MAX_TOOL_RESULT_CHARS) {
          content = content.slice(0, MAX_TOOL_RESULT_CHARS) + "…(cut: ask for a shorter time range)";
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        opts.onEvent({ type: "tool", summary: `${call.function.name} failed: ${message}`, failed: true });
        content = JSON.stringify({ error: message });
      }
      history.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  return { history, costUsd: cost };
}
