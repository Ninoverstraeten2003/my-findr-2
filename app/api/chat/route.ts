// Proxy for the AI chat: forwards one chat-completions step to OpenRouter. The tools themselves run in the
// browser (only it can decrypt reports), so this route only sees the conversation and adds the key.
//  - Zero data retention is forced on every request.
//  - Same key rules as /api/jev: the user's own key, or the owner's key behind the access token.
//  - With the shared key only the cheap, tested models are allowed; a daily cap backs that up.
// Request bodies are never logged.

import { NextResponse } from "next/server";
import { resolveOpenRouterKey, takeSharedQuota } from "@/lib/server/openrouter-auth";
import { CHAT_MODELS } from "@/lib/ai-chat-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPSTREAM = process.env.OPENROUTER_CHAT_URL || "https://openrouter.ai/api/v1/chat/completions";
const UPSTREAM_TIMEOUT_MS = 50_000;
const MAX_BODY_BYTES = 600 * 1024;
const MAX_MESSAGES = 120;
const MAX_TOOLS = 16;
const MAX_OUTPUT_TOKENS = 1500;
const SHARED_DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT || 2000);
const MODEL_RE = /^[A-Za-z0-9._\-/:~]{3,100}$/;

function err(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const key = resolveOpenRouterKey(request);
  if ("error" in key) return err(key.status, key.error);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return err(413, "Conversation too long, start a new one");
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return err(400, "invalid JSON");
  }

  const model = body?.model;
  if (typeof model !== "string" || !MODEL_RE.test(model)) return err(400, "bad model");
  if (!key.usingOwnKey && !CHAT_MODELS.some((m) => m.id === model)) {
    return err(403, "With the shared key only the listed models can be used; add your own OpenRouter key for others");
  }
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return err(400, "bad messages");
  }
  const tools = body?.tools;
  if (tools !== undefined && (!Array.isArray(tools) || tools.length > MAX_TOOLS)) return err(400, "bad tools");

  if (!key.usingOwnKey && !takeSharedQuota("chat", 1, SHARED_DAILY_LIMIT)) {
    return err(429, "Daily limit for the shared chat key reached");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        "content-type": "application/json",
        "x-title": "MyFindr",
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
        max_tokens: MAX_OUTPUT_TOKENS,
        provider: { zdr: true, data_collection: "deny" },
        usage: { include: true },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return err(401, key.usingOwnKey ? "OpenRouter rejected your key" : "OpenRouter rejected the shared key");
      }
      if (res.status === 402) {
        return err(402, key.usingOwnKey ? "Your OpenRouter account is out of credit" : "The shared OpenRouter key is out of credit");
      }
      if (res.status === 404) return err(404, "No zero-data-retention provider for this model right now; pick another model");
      return err(502, `OpenRouter answered ${res.status}`);
    }
    const data = JSON.parse(text);
    return NextResponse.json(
      { choices: data.choices, usage: data.usage, model: data.model, provider: data.provider },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return err(e instanceof Error && e.name === "AbortError" ? 504 : 502, "OpenRouter unavailable");
  } finally {
    clearTimeout(timer);
  }
}
