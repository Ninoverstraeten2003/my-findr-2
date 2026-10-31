// Models offered for the AI chat. All were tested with zero data retention and tool calling (Oct 2026).
// Price: OpenRouter's USD per million tokens (input / output). "Measured": one real "what did my tag do today"
// question with 3-6 tool steps on this app.
export const CHAT_MODELS = [
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", price: "$0.10 / $0.50", measured: "fastest, most thorough · ~$0.002 and ~9 s per question" },
  { id: "z-ai/glm-5.3-flash", label: "GLM-5.3 Flash", price: "$0.016 / $0.15", measured: "cheapest · ~$0.0002 and ~30 s per question" },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", price: "$0.045 / $0.50", measured: "cheap · ~$0.0002 per question" },
] as const;

/** Default: Claude Haiku 5.5, still well under a cent per question but much faster than the cheapest option. */
export const DEFAULT_CHAT_MODEL = CHAT_MODELS[0].id;
