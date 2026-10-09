// Adapter for Gemini CLI, API-key auth only.
//
// Gemini's REST API puts the model id in the URL path (POST
// /v1beta/models/{model}:generateContent), not in the JSON body, so this adapter rewrites
// the path rather than the body. Note on scope: Gemini CLI's Google-account/subscription
// login talks to a separate, undocumented internal endpoint that ignores the CLI's base-URL
// override entirely, so it cannot be routed this way — only GEMINI_API_KEY sessions can.

import { createHash } from "node:crypto";
import { findOnPath } from "../launcher.js";

export const SENTINEL_MODEL = "router-auto";

const MODEL_ENV = {
  fast: "ROUTECLI_GEMINI_FAST",
  balanced: "ROUTECLI_GEMINI_BALANCED",
  strong: "ROUTECLI_GEMINI_STRONG",
  deep: "ROUTECLI_GEMINI_DEEP",
};

const DEFAULT_MODELS = {
  fast: "gemini-2.5-flash-lite",
  balanced: "gemini-2.5-flash",
  strong: "gemini-2.5-pro",
  // Gemini has no distinct long-context tier yet; "deep" rides on the same model as "strong"
  // until one exists. Override ROUTECLI_GEMINI_DEEP if that changes for your account.
  deep: "gemini-2.5-pro",
};

export const modelIdForTier = (tier) => process.env[MODEL_ENV[tier]] || DEFAULT_MODELS[tier];

export function tierForModelId(modelId) {
  const configured = Object.keys(DEFAULT_MODELS).find((tier) => modelIdForTier(tier) === modelId);
  if (configured) return configured;
  if (/pro/i.test(modelId ?? "")) return "strong";
  if (/flash-lite/i.test(modelId ?? "")) return "fast";
  if (/flash/i.test(modelId ?? "")) return "balanced";
  return null;
}

// Matches both the plain and streaming generateContent actions, capturing the model segment
// so it can be swapped for the routed model id.
const GENERATE_PATH = /^(\/v1beta\/models\/)([^/:?]+)((?::(?:stream)?[Gg]enerate[Cc]ontent)[^?]*)(\?.*)?$/;

function lastUserText(contents) {
  if (!Array.isArray(contents)) return null;
  const last = contents[contents.length - 1];
  if (last?.role !== "user" || !Array.isArray(last.parts)) return null;
  if (last.parts.some((part) => part.functionResponse)) return null; // tool-result continuation
  const text = last.parts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || null;
}

const availableTiers = () =>
  Object.keys(DEFAULT_MODELS).filter((tier) => tier !== "deep" || process.env.ROUTECLI_ALLOW_DEEP === "1");

export const geminiProvider = {
  id: "gemini",
  binaryName: "gemini",
  upstreamBaseURL: () => "https://generativelanguage.googleapis.com",
  availableTiers,

  isRoutableRequest: (method, url) => method === "POST" && GENERATE_PATH.test(url ?? ""),

  readTurn(body, url) {
    const match = GENERATE_PATH.exec(url ?? "");
    const requestedModel = match?.[2] ?? "";
    const firstText = typeof body?.contents?.[0]?.parts?.[0]?.text === "string"
      ? body.contents[0].parts[0].text
      : "";
    const conversationId = createHash("sha1").update(firstText).digest("hex").slice(0, 12);

    if (requestedModel !== SENTINEL_MODEL) {
      return { isSentinel: false, promptText: "manual", conversationId };
    }
    return { isSentinel: true, promptText: lastUserText(body?.contents), conversationId };
  },

  modelIdForTier,
  tierForModelId,

  estimateContextTokens: (body) => Math.round(JSON.stringify(body?.contents ?? []).length / 4),

  applyTier(body, url, _tier, modelId) {
    const match = GENERATE_PATH.exec(url ?? "");
    if (!match) return { body, url };
    const [, prefix, , action, query] = match;
    return { body, url: `${prefix}${modelId}${action}${query ?? ""}` };
  },

  locateBinary: () => findOnPath("gemini"),

  buildLaunch({ proxyBaseURL, forwardedArgs = [] }) {
    const userPickedModel = forwardedArgs.some((arg) => arg === "-m" || arg === "--model");
    return {
      env: { GOOGLE_GEMINI_BASE_URL: proxyBaseURL },
      extraArgs: userPickedModel ? [] : ["--model", SENTINEL_MODEL],
    };
  },
};
