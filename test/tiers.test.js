import test from "node:test";
import assert from "node:assert/strict";
import { decideTier, findExplicitTier, TIER_NAMES } from "../src/tiers.js";

test("finds an explicit tier request in the prompt", () => {
  assert.equal(findExplicitTier("use the strong model for this"), "strong");
  assert.equal(findExplicitTier("just do it quickly, use fast"), "fast");
  assert.equal(findExplicitTier("nothing special here"), null);
});

test("an explicit request beats the brain's answer", () => {
  const result = decideTier({
    promptText: "use strong please",
    brainAnswer: { tier: "fast", confidence: 0.99 },
    currentTier: "balanced",
    availableTiers: TIER_NAMES,
  });
  assert.equal(result.tier, "strong");
  assert.equal(result.reason, "explicit-request");
});

test("keeps the current tier when the brain is unavailable", () => {
  const result = decideTier({
    promptText: "fix the bug",
    brainAnswer: null,
    currentTier: "balanced",
    availableTiers: TIER_NAMES,
  });
  assert.equal(result.tier, "balanced");
  assert.equal(result.reason, "brain-unavailable/unchanged");
  assert.equal(result.changed, false);
});

test("never downgrades on a low-confidence answer", () => {
  const result = decideTier({
    promptText: "something",
    brainAnswer: { tier: "fast", confidence: 0.1 },
    currentTier: "strong",
    availableTiers: TIER_NAMES,
  });
  assert.equal(result.tier, "strong");
  assert.equal(result.reason, "low-confidence-keep/unchanged");
});

test("caps a low-confidence upgrade at the safe ceiling", () => {
  const result = decideTier({
    promptText: "something",
    brainAnswer: { tier: "deep", confidence: 0.1 },
    currentTier: "fast",
    availableTiers: TIER_NAMES,
  });
  assert.equal(result.tier, "balanced");
  assert.equal(result.reason, "low-confidence-capped");
});

test("refuses a downgrade once the context is too large to rebuild cheaply", () => {
  const result = decideTier({
    promptText: "something",
    brainAnswer: { tier: "fast", confidence: 0.9 },
    currentTier: "strong",
    availableTiers: TIER_NAMES,
    contextTokens: 50000,
  });
  assert.equal(result.tier, "strong");
  assert.equal(result.reason, "downgrade-too-costly/unchanged");
});

test("steps up instead of landing on an unavailable tier", () => {
  const result = decideTier({
    promptText: "something",
    brainAnswer: { tier: "fast", confidence: 0.95 },
    currentTier: "strong",
    availableTiers: ["balanced", "strong"],
  });
  // "fast" isn't available, so it steps up to the nearest tier the account can run.
  assert.equal(result.tier, "balanced");
  assert.equal(result.reason, "brain-decision+unsupported");
});

test("follows a confident brain answer within bounds", () => {
  const result = decideTier({
    promptText: "debug this intermittent race condition",
    brainAnswer: { tier: "strong", confidence: 0.92 },
    currentTier: "balanced",
    availableTiers: TIER_NAMES,
  });
  assert.equal(result.tier, "strong");
  assert.equal(result.reason, "brain-decision");
  assert.equal(result.changed, true);
});
