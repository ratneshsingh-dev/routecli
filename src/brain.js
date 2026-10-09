// Asks TypeSafe's Jev classifier which tier a turn needs. Kept deliberately small: one
// choice question, answered against the plain tier vocabulary in tiers.js, so the same
// call works unmodified for every provider adapter.

import { TypeSafeClient, choice } from "@typesafe-ai/sdk";

let client;
function getClient() {
  // Constructed lazily: the SDK throws when no key is configured, and a missing key should
  // degrade this whole module to "never routes", not crash whichever CLI imported it.
  client ??= new TypeSafeClient({
    apiKey: process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY,
    timeout: 1500,
    retry: { maxRetries: 1 },
    logLevel: "warn",
  });
  return client;
}

const TIER_GUIDANCE = {
  fast: "Trivial, mechanical, or purely factual requests: typo fixes, renames, one obvious command.",
  balanced: "Ordinary bounded engineering work: implement a described function, fix an understood bug.",
  strong: "Hard reasoning, ambiguity, or wide blast radius: unknown-cause debugging, cross-module design, security.",
  deep: "Very large or long-running work: whole-repo migrations, unusually large context.",
};

/**
 * @param {object} input
 * @param {string} input.prompt
 * @param {string} input.currentTier
 * @param {number} input.contextTokens
 * @returns {Promise<?{tier: string, confidence: number, probabilities: object, ms: number}>}
 *   null on any failure — callers must treat that as "keep the current tier".
 */
export async function askBrain({ prompt, currentTier, contextTokens }) {
  if (!process.env.JEV_API_KEY && !process.env.TYPESAFE_API_KEY) return null;
  const started = Date.now();
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 3000);
  try {
    const result = await getClient().systemOne(
      {
        state: {
          request: prompt,
          session: { current_tier: currentTier, context_tokens: contextTokens },
        },
        questions: {
          tier: choice(
            "Pick the cheapest tier that can fully complete this coding request in one pass, " +
              "without needing to retry on a stronger tier afterwards.",
            TIER_GUIDANCE,
          ),
        },
      },
      { signal: abort.signal },
    );
    const answer = result.answers.tier;
    return {
      tier: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      ms: Date.now() - started,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(deadline);
  }
}
