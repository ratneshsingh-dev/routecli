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

// Graded on how much reasoning the answer demands, not on whether it involves code: these
// CLIs get asked to explain and design at least as often as they get asked to edit files.
const TIER_GUIDANCE = {
  fast: "A single recalled fact or one mechanical edit. The answer is looked up, not worked out: a capital city, a typo fix, a rename, one obvious command.",
  balanced: "Routine work with a clear shape: implement a described function, fix an understood bug, or explain a well-defined topic at ordinary depth.",
  strong: "The answer has to be reasoned out rather than recalled: system and architecture design, unknown-cause debugging, security, concurrency, tradeoff analysis, or explaining a subtle topic where precision and caveats matter.",
  deep: "Very large or long-running work: whole-repo migrations, or analysis spanning many interacting parts at once.",
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
            "Pick the cheapest tier that can fully answer this request in one pass, without " +
              "needing to retry on a stronger tier afterwards. Judge the reasoning the answer " +
              "demands, not whether the request mentions code and not how long the reply will be.",
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
