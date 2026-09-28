// Server-side proxy to OpenRouter's Jev Decisions API (same approach as the Plate proxy):
//  - OPENROUTER_API_KEY never reaches the browser.
//  - Every call is forced to zero data retention.
//  - Only typesafe/jev-1.13 and well-formed choice / noul / score questions go through.
//  - Who pays: a user's own OpenRouter key (x-openrouter-key header) is used as-is for that request and never
//    stored or logged. Without one, the owner's OPENROUTER_API_KEY is used, but only when x-jev-token matches
//    JEV_ACCESS_TOKEN (required in production), with a daily cap.
// Request bodies are never logged.

import { NextResponse } from "next/server";
import {
  JEV_MAX_INSTRUCTION_CHARS,
  JEV_MAX_ITEMS_PER_CALL,
  JEV_MAX_OPTION_CHARS,
  JEV_MAX_QUESTIONS,
  JEV_MAX_STATE_CHARS,
  JEV_MODEL,
  type JevWireQuestion,
} from "@/lib/jev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPSTREAM = process.env.OPENROUTER_DECISIONS_URL || "https://openrouter.ai/api/alpha/decisions";
const UPSTREAM_TIMEOUT_MS = 12_000;
const UPSTREAM_CONCURRENCY = 6;
const MAX_BODY_BYTES = 256 * 1024;
const DAILY_LIMIT = Number(process.env.JEV_DAILY_LIMIT || 20_000);

// Approximate per-instance daily counter: a backstop, the client budget check is the main cost control.
let day = "";
let callsToday = 0;

const KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
// OpenRouter keys look like sk-or-v1-<hex>; the check only rejects obvious junk before calling upstream.
const USER_KEY_RE = /^sk-or-[A-Za-z0-9_-]{10,200}$/;
const ITEM_KEY_RE = /^[A-Za-z0-9_:-]{1,80}$/;

function err(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function sanitizeQuestions(input: unknown): { value?: Record<string, JevWireQuestion>; error?: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { error: "bad questions" };
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.length > JEV_MAX_QUESTIONS) return { error: "too many or too few questions" };
  const str = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  const clean: Record<string, JevWireQuestion> = {};
  for (const key of keys) {
    if (!KEY_RE.test(key)) return { error: `bad question key ${key}` };
    const q = (input as Record<string, any>)[key];
    if (typeof q !== "object" || q === null) return { error: `bad question ${key}` };
    if (!str(q.instructions, JEV_MAX_INSTRUCTION_CHARS)) return { error: `bad instructions for ${key}` };
    if (q.type === "choice") {
      const c = q.criteria;
      if (typeof c !== "object" || c === null || Array.isArray(c)) return { error: `bad criteria for ${key}` };
      const opts = Object.keys(c);
      if (opts.length < 2 || opts.length > 16) return { error: `choice ${key} needs 2-16 options` };
      for (const o of opts) if (!KEY_RE.test(o) || !str(c[o], JEV_MAX_OPTION_CHARS)) return { error: `bad option in ${key}` };
      clean[key] = { type: "choice", instructions: q.instructions, criteria: Object.fromEntries(opts.map((o) => [o, c[o]])) };
    } else if (q.type === "noul") {
      const c = q.criteria;
      if (typeof c !== "object" || c === null || !str(c.true, JEV_MAX_OPTION_CHARS) || !str(c.false, JEV_MAX_OPTION_CHARS)) {
        return { error: `noul ${key} needs true/false criteria` };
      }
      clean[key] = { type: "noul", instructions: q.instructions, criteria: { true: c.true, false: c.false } };
    } else if (q.type === "score") {
      const c = q.criteria;
      if (!Array.isArray(c) || c.length < 2 || c.length > 10 || !c.every((l) => str(l, JEV_MAX_OPTION_CHARS))) {
        return { error: `score ${key} needs 2-10 levels` };
      }
      clean[key] = { type: "score", instructions: q.instructions, criteria: [...c] };
    } else {
      return { error: `unknown question type for ${key}` };
    }
  }
  return { value: clean };
}

type AskResult =
  | { answers: Record<string, unknown>; inputTokens: number; cost: number }
  | { error: string; status?: number };

async function askOne(apiKey: string, state: string, questions: Record<string, JevWireQuestion>): Promise<AskResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-title": "MyFindr",
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state,
        questions,
        provider: { zdr: true, data_collection: "deny" },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { error: `upstream ${res.status}`, status: res.status };
    const data = JSON.parse(text);
    return {
      answers: data.answers as Record<string, unknown>,
      inputTokens: Number(data.usage?.input_tokens ?? 0),
      cost: Number(data.usage?.cost ?? 0),
    };
  } catch (e) {
    return { error: e instanceof Error && e.name === "AbortError" ? "upstream timeout" : "upstream unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  // A user's own key wins; otherwise fall back to the owner's key behind the access token.
  const userKey = request.headers.get("x-openrouter-key")?.trim() || "";
  const usingOwnKey = userKey !== "";
  let apiKey: string;
  if (usingOwnKey) {
    if (!USER_KEY_RE.test(userKey)) return err(400, "That doesn't look like an OpenRouter key (sk-or-...)");
    apiKey = userKey;
  } else {
    const serverKey = process.env.OPENROUTER_API_KEY;
    if (!serverKey) return err(401, "Add your own OpenRouter key in Settings (this server has no shared key)");
    const requiredToken = process.env.JEV_ACCESS_TOKEN;
    if (!requiredToken && process.env.NODE_ENV === "production") {
      return err(401, "Add your own OpenRouter key in Settings (the shared key is disabled on this server)");
    }
    if (requiredToken && request.headers.get("x-jev-token") !== requiredToken) {
      return err(401, "Add your own OpenRouter key in Settings, or the site owner's access token");
    }
    apiKey = serverKey;
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return err(413, "request too large");
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return err(400, "invalid JSON");
  }

  const { value: questions, error } = sanitizeQuestions(body?.questions);
  if (error || !questions) return err(400, error ?? "bad questions");

  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > JEV_MAX_ITEMS_PER_CALL) {
    return err(400, `send 1-${JEV_MAX_ITEMS_PER_CALL} items`);
  }
  for (const it of items) {
    if (typeof it?.key !== "string" || !ITEM_KEY_RE.test(it.key)) return err(400, "bad item key");
    if (typeof it?.state !== "string" || it.state.length === 0 || it.state.length > JEV_MAX_STATE_CHARS) {
      return err(400, "bad item state");
    }
  }

  // The daily cap protects the owner's key; users with their own key pay for themselves.
  if (!usingOwnKey) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      callsToday = 0;
    }
    if (callsToday + items.length > DAILY_LIMIT) return err(429, "Daily limit for the shared Jev key reached");
    callsToday += items.length;
  }

  const results: Record<string, { answers?: Record<string, unknown>; error?: string }> = {};
  let inputTokens = 0;
  let cost = 0;
  let next = 0;
  const statuses: number[] = [];
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      const r = await askOne(apiKey, it.state, questions);
      if ("answers" in r) {
        results[it.key] = { answers: r.answers };
        inputTokens += r.inputTokens;
        cost += r.cost;
      } else {
        results[it.key] = { error: r.error };
        if (r.status) statuses.push(r.status);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPSTREAM_CONCURRENCY, items.length) }, worker));

  // Every item refused for the same key problem: say so plainly instead of reporting N failures.
  if (statuses.length === items.length) {
    if (statuses.every((s) => s === 401 || s === 403)) {
      return err(401, usingOwnKey ? "OpenRouter rejected your key" : "OpenRouter rejected the shared key");
    }
    if (statuses.every((s) => s === 402)) {
      return err(402, usingOwnKey ? "Your OpenRouter account is out of credit" : "The shared OpenRouter key is out of credit");
    }
  }

  return NextResponse.json(
    { results, usage: { input_tokens: inputTokens, cost } },
    { headers: { "cache-control": "no-store" } },
  );
}
