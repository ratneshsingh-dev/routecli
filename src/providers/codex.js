// Adapter for OpenAI Codex. Talks the Responses API shape (POST /responses, model in the
// body, turns stored as an `input` array). Codex authenticates either against the public
// API or, for a subscription login, against the ChatGPT backend — the proxy has to pick the
// same backend Codex itself would have used, which is signalled by the auth headers it sends.

import { createHash } from "node:crypto";
import { findOnPath } from "../launcher.js";

export const SENTINEL_MODEL = "router-auto";
const PROVIDER_NAME = "routecli";

const MODEL_ENV = {
  fast: "ROUTECLI_CODEX_FAST",
  balanced: "ROUTECLI_CODEX_BALANCED",
  strong: "ROUTECLI_CODEX_STRONG",
  deep: "ROUTECLI_CODEX_DEEP",
};

const DEFAULT_MODELS = {
  fast: process.env.ROUTECLI_CODEX_FAST || "gpt-5-mini",
  balanced: process.env.ROUTECLI_CODEX_BALANCED || "gpt-5",
  strong: process.env.ROUTECLI_CODEX_STRONG || "gpt-5-pro",
  deep: process.env.ROUTECLI_CODEX_DEEP || "gpt-5-pro",
};

export const modelIdForTier = (tier) => process.env[MODEL_ENV[tier]] || DEFAULT_MODELS[tier];

export function tierForModelId(modelId) {
  const configured = Object.keys(DEFAULT_MODELS).find((tier) => modelIdForTier(tier) === modelId);
  if (configured) return configured;
  if (/pro|opus|strong/i.test(modelId ?? "")) return "strong";
  if (/mini|nano|fast/i.test(modelId ?? "")) return "fast";
  return /^gpt-/i.test(modelId ?? "") ? "balanced" : null;
}

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" || item?.type === "input_text")
    .map((item) => item.text)
    .join("\n");
};

const stripNoise = (text) =>
  text
    .replace(/<system[-_]reminder>[\s\S]*?<\/system[-_]reminder>/gi, "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "")
    .trim();

function lastUserTurn(input) {
  if (!Array.isArray(input)) return null;
  const hasToolMarker = input.some((item) => item?.type === "additional_tools");
  if (!hasToolMarker) return null;
  for (const item of [...input].reverse()) {
    if (item?.type === "function_call_output" || item?.type === "custom_tool_call_output") return null;
    if (item?.role !== "user") continue;
    const cleaned = stripNoise(textOf(item.content));
    return cleaned || null;
  }
  return null;
}

const availableTiers = () =>
  Object.keys(DEFAULT_MODELS).filter((tier) => tier !== "deep" || process.env.ROUTECLI_ALLOW_DEEP === "1");

export const codexProvider = {
  id: "codex",
  binaryName: "codex",
  availableTiers,

  upstreamBaseURL: (headers) =>
    headers["chatgpt-account-id"] ? "https://chatgpt.com/backend-api/codex" : "https://api.openai.com/v1",

  isRoutableRequest: (method, url) => method === "POST" && /^\/responses/.test(url),

  readTurn(body, _url) {
    const conversationId = createHash("sha1")
      .update(String(body?.prompt_cache_key ?? `${body?.instructions ?? ""}|${textOf(body?.input?.[0]?.content)}`))
      .digest("hex")
      .slice(0, 12);
    if (body.model !== SENTINEL_MODEL) {
      return { isSentinel: false, promptText: "manual", conversationId };
    }
    return { isSentinel: true, promptText: lastUserTurn(body.input), conversationId };
  },

  modelIdForTier,
  tierForModelId,

  estimateContextTokens: (body) => Math.round(JSON.stringify(body?.input ?? []).length / 4),

  applyTier(body, url, _tier, modelId) {
    body.model = modelId;
    return { body, url };
  },

  locateBinary: () => findOnPath("codex"),

  buildLaunch({ proxyBaseURL, forwardedArgs = [] }) {
    const userPickedModel = forwardedArgs.some(
      (arg) => arg === "--model" || arg === "-m" || arg.startsWith("--model="),
    );
    return {
      env: {},
      extraArgs: [
        ...(userPickedModel ? [] : ["--model", SENTINEL_MODEL]),
        "--config",
        `model_provider="${PROVIDER_NAME}"`,
        "--config",
        `model_providers.${PROVIDER_NAME}.name="Model Router"`,
        "--config",
        `model_providers.${PROVIDER_NAME}.base_url="${proxyBaseURL}"`,
        "--config",
        `model_providers.${PROVIDER_NAME}.wire_api="responses"`,
        "--config",
        `model_providers.${PROVIDER_NAME}.requires_openai_auth=true`,
      ],
    };
  },
};
