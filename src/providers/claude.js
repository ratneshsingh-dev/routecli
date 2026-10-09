// Adapter for Claude Code. Talks the Messages API shape: the model id lives in the request
// body, a conversation is identified by Claude Code's own session metadata, and the account's
// tier capabilities (adaptive thinking, effort) have to be stripped from a request before it
// reaches a tier that cannot accept them.

import { createHash } from "node:crypto";
import { findOnPath } from "../launcher.js";

export const SENTINEL_MODEL = "router-auto";

const MODEL_ENV = {
  fast: "ROUTECLI_CLAUDE_FAST",
  balanced: "ROUTECLI_CLAUDE_BALANCED",
  strong: "ROUTECLI_CLAUDE_STRONG",
  deep: "ROUTECLI_CLAUDE_DEEP",
};

// Defaults match the account's current generation; override per tier with the env vars above
// if your account's catalog uses different ids.
const DEFAULT_MODELS = {
  fast: "claude-haiku-4-5-20251001",
  balanced: "claude-sonnet-5",
  strong: "claude-opus-5",
  deep: "claude-fable-5-1",
};

// Haiku-class models reject thinking/effort fields outright, so a downgrade from a stronger
// tier has to strip them or the API returns a hard 400.
const TIER_CAPABILITIES = {
  fast: { thinking: false, effort: false },
  balanced: { thinking: true, effort: true },
  strong: { thinking: true, effort: true },
  deep: { thinking: true, effort: true },
};

const FAMILY_HINTS = { fast: "haiku", balanced: "sonnet", strong: "opus", deep: "fable" };

export const modelIdForTier = (tier) => process.env[MODEL_ENV[tier]] || DEFAULT_MODELS[tier];

export function tierForModelId(modelId) {
  const entry = Object.entries(FAMILY_HINTS).find(([, hint]) => (modelId ?? "").includes(hint));
  return entry?.[0] ?? null;
}

/**
 * Claude Code sends draft-04 JSON Schema relics in MCP tool definitions and normally
 * upgrades them itself before a first-party request, but skips that step once a custom
 * base URL is in play, so the API rejects the request. In draft 2020-12,
 * exclusiveMinimum/Maximum are numbers rather than booleans.
 */
function fixLegacySchema(node) {
  if (Array.isArray(node)) return node.forEach(fixLegacySchema);
  if (!node || typeof node !== "object") return;
  for (const [flag, bound] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]]) {
    if (typeof node[flag] === "boolean") {
      if (node[flag] && typeof node[bound] === "number") {
        node[flag] = node[bound];
        delete node[bound];
      } else {
        delete node[flag];
      }
    }
  }
  for (const value of Object.values(node)) fixLegacySchema(value);
}

function sessionIdOf(body) {
  try {
    return JSON.parse(body?.metadata?.user_id ?? "{}").session_id ?? "";
  } catch {
    return "";
  }
}

function textOfMessage(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return null;
  if (message.content.some((block) => block.type === "tool_result")) return null;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// "deep" bills separate usage credits on most accounts, so it is opt-in only, same as the
// other providers' priciest tier.
const availableTiers = () =>
  Object.keys(DEFAULT_MODELS).filter((tier) => tier !== "deep" || process.env.ROUTECLI_ALLOW_DEEP === "1");

export const claudeProvider = {
  id: "claude",
  binaryName: "claude",
  upstreamBaseURL: () => "https://api.anthropic.com",
  availableTiers,

  isRoutableRequest: (method, url) => method === "POST" && /^\/v1\/messages/.test(url),

  readTurn(body, _url) {
    body.tools?.forEach((tool) => fixLegacySchema(tool.input_schema));
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const isAgentTurn = Array.isArray(body?.tools) && body.tools.length > 0;
    const session = sessionIdOf(body);
    const firstText = typeof messages[0]?.content === "string" ? messages[0].content : "";
    const conversationId = createHash("sha1").update(`${session}|${firstText}`).digest("hex").slice(0, 12);

    if (body.model !== SENTINEL_MODEL) {
      return { isSentinel: false, promptText: isAgentTurn ? "manual" : null, conversationId };
    }
    if (!isAgentTurn) {
      return { isSentinel: true, promptText: null, conversationId };
    }
    // Claude Code appends a trailing environment-context message after the real user turn,
    // so the most recent "user" message, not strictly the last message, is the actual turn.
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const text = lastUser && textOfMessage(lastUser);
    const cleaned = text?.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
    return { isSentinel: true, promptText: cleaned || null, conversationId };
  },

  modelIdForTier,
  tierForModelId,

  // Only the conversation itself, not the system prompt or tool schemas Claude Code resends
  // on every request, which would otherwise make the context look huge from message one.
  estimateContextTokens: (body) => Math.round(JSON.stringify(body?.messages ?? []).length / 4),

  applyTier(body, url, tier, modelId) {
    body.model = modelId;
    const caps = TIER_CAPABILITIES[tier] ?? TIER_CAPABILITIES.strong;
    if (!caps.thinking) {
      delete body.thinking;
      // A context-management strategy that prunes thinking blocks is itself rejected once
      // thinking is gone, so it has to be removed along with it.
      const edits = body.context_management?.edits;
      if (Array.isArray(edits)) {
        body.context_management.edits = edits.filter((edit) => !/thinking/i.test(edit?.type ?? ""));
        if (body.context_management.edits.length === 0) delete body.context_management;
      }
    }
    if (!caps.effort && body.output_config) {
      delete body.output_config.effort;
      if (Object.keys(body.output_config).length === 0) delete body.output_config;
    }
    return { body, url };
  },

  locateBinary: () => findOnPath("claude"),

  /** Env vars + args to add so Claude Code routes through the proxy and offers the sentinel. */
  buildLaunch({ proxyBaseURL }) {
    return {
      env: {
        ANTHROPIC_BASE_URL: proxyBaseURL,
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || SENTINEL_MODEL,
        ANTHROPIC_CUSTOM_MODEL_OPTION: SENTINEL_MODEL,
        ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: "Model Router",
        ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: "Route each turn to the cheapest model that can do it",
        ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES:
          "thinking,adaptive_thinking,interleaved_thinking,effort,max_effort",
        CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1",
      },
      extraArgs: [],
    };
  },
};
