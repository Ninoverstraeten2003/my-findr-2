// Server-only: decides which OpenRouter key pays for an AI chat request.
//  - A user's own key (x-openrouter-key header) is used as-is for that request, never stored or logged.
//  - Otherwise the owner's OPENROUTER_API_KEY, only when x-owner-token matches the owner access token
//    (OWNER_ACCESS_TOKEN, or JEV_ACCESS_TOKEN from before Jev was removed; required in production), with a
//    per-instance daily cap.

// OpenRouter keys look like sk-or-v1-<hex>; the check only rejects obvious junk before calling upstream.
const USER_KEY_RE = /^sk-or-[A-Za-z0-9_-]{10,200}$/;

export type KeyResolution =
  | { apiKey: string; usingOwnKey: boolean }
  | { status: number; error: string };

export function resolveOpenRouterKey(request: Request): KeyResolution {
  const userKey = request.headers.get("x-openrouter-key")?.trim() || "";
  if (userKey) {
    if (!USER_KEY_RE.test(userKey)) return { status: 400, error: "That doesn't look like an OpenRouter key (sk-or-...)" };
    return { apiKey: userKey, usingOwnKey: true };
  }
  const serverKey = process.env.OPENROUTER_API_KEY;
  if (!serverKey) return { status: 401, error: "Add your own OpenRouter key in Settings (this server has no shared key)" };
  const requiredToken = process.env.OWNER_ACCESS_TOKEN || process.env.JEV_ACCESS_TOKEN;
  if (!requiredToken && process.env.NODE_ENV === "production") {
    return { status: 401, error: "Add your own OpenRouter key in Settings (the shared key is disabled on this server)" };
  }
  if (requiredToken && request.headers.get("x-owner-token") !== requiredToken) {
    return { status: 401, error: "Add your own OpenRouter key in Settings, or the site owner's access token" };
  }
  return { apiKey: serverKey, usingOwnKey: false };
}

// Approximate per-instance daily counter for the shared key: a backstop next to the client-side budgets.
const counters = new Map<string, { day: string; used: number }>();

/** Counts `units` against a named daily limit; returns false (and counts nothing) when it would exceed it. */
export function takeSharedQuota(name: string, units: number, dailyLimit: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const c = counters.get(name);
  const used = c && c.day === today ? c.used : 0;
  if (used + units > dailyLimit) return false;
  counters.set(name, { day: today, used: used + units });
  return true;
}
