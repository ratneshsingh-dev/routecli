// Provider-agnostic tier vocabulary and decision policy. Every CLI adapter maps its own
// real model ids onto these four names, so the routing brain only ever has to reason about
// "fast / balanced / strong / deep" regardless of which assistant is running.

export const TIER_NAMES = ["fast", "balanced", "strong", "deep"];

export const tierRank = (name) => TIER_NAMES.indexOf(name);

// Spoken aliases a user might type to force a tier by hand, e.g. "use opus-level reasoning"
// or "answer this with the strong model". Kept deliberately small and literal; anything more
// clever belongs to the routing brain, not a regex.
const OVERRIDE_WORDS = {
  fast: ["fast", "quick", "cheap"],
  balanced: ["balanced", "normal", "default"],
  strong: ["strong", "smart", "hard", "deep reasoning"],
  deep: ["deep", "long", "extended", "max context"],
};

const OVERRIDE_PATTERNS = TIER_NAMES.map((tier) => ({
  tier,
  pattern: new RegExp(`\\b(?:use|switch to|force|run (?:this|it) on)\\s+(?:the\\s+)?(?:${OVERRIDE_WORDS[tier].join("|")})\\b`, "i"),
}));

export function findExplicitTier(promptText) {
  const text = promptText ?? "";
  const hit = OVERRIDE_PATTERNS.find(({ pattern }) => pattern.test(text));
  return hit?.tier ?? null;
}

const DEFAULT_THRESHOLDS = {
  minConfidence: 0.3,
  uncertainCeiling: "balanced",
  maxContextTokensForDowngrade: 20000,
};

function clampToAvailable(tier, availableTiers) {
  if (availableTiers.includes(tier)) return tier;
  const rank = tierRank(tier);
  const higher = TIER_NAMES.filter((t, i) => i > rank && availableTiers.includes(t));
  if (higher.length) return higher[0];
  const lower = TIER_NAMES.filter((t, i) => i < rank && availableTiers.includes(t));
  return lower.length ? lower[lower.length - 1] : null;
}

/**
 * Decides the tier to actually run a turn on. Never throws; any missing or malformed
 * input falls back to whatever tier is already active for the conversation.
 *
 * @param {object} input
 * @param {string} input.promptText        raw text of the turn, used only to look for an explicit override
 * @param {?{tier: string, confidence: number}} input.brainAnswer  null when the routing call failed
 * @param {string} input.currentTier       tier the conversation is currently pinned to
 * @param {string[]} input.availableTiers  tiers this account/provider can actually run
 * @param {number} [input.contextTokens]   rough size of the conversation so far
 * @param {object} [input.thresholds]      override DEFAULT_THRESHOLDS for testing
 */
export function decideTier({
  promptText,
  brainAnswer,
  currentTier,
  availableTiers,
  contextTokens = 0,
  thresholds = DEFAULT_THRESHOLDS,
}) {
  const land = (tier, reason) => {
    const final = clampToAvailable(tier, availableTiers) ?? currentTier;
    const settledReason = final === tier ? reason : `${reason}+unsupported`;
    return {
      tier: final,
      reason: final === currentTier ? `${settledReason}/unchanged` : settledReason,
      changed: final !== currentTier,
    };
  };

  const explicit = findExplicitTier(promptText);
  if (explicit) return land(explicit, "explicit-request");

  if (!brainAnswer || !TIER_NAMES.includes(brainAnswer.tier)) {
    return land(currentTier, "brain-unavailable");
  }

  let target = brainAnswer.tier;

  if (brainAnswer.confidence < thresholds.minConfidence) {
    if (tierRank(target) < tierRank(currentTier)) {
      return land(currentTier, "low-confidence-keep");
    }
    const ceiling = Math.max(tierRank(currentTier), tierRank(thresholds.uncertainCeiling));
    if (tierRank(target) > ceiling) {
      return land(TIER_NAMES[ceiling], "low-confidence-capped");
    }
  }

  const isDowngrade = tierRank(target) < tierRank(currentTier);
  if (isDowngrade && contextTokens > thresholds.maxContextTokensForDowngrade) {
    return land(currentTier, "downgrade-too-costly");
  }

  return land(target, "brain-decision");
}
