import test from "node:test";
import assert from "node:assert/strict";
import { claudeProvider, SENTINEL_MODEL, modelIdForTier, tierForModelId } from "../src/providers/claude.js";

test("recognises the Messages endpoint as routable", () => {
  assert.equal(claudeProvider.isRoutableRequest("POST", "/v1/messages"), true);
  assert.equal(claudeProvider.isRoutableRequest("GET", "/v1/messages"), false);
  assert.equal(claudeProvider.isRoutableRequest("POST", "/v1/models"), false);
});

test("reads a fresh user turn and ignores tool-result continuations", () => {
  const body = {
    model: SENTINEL_MODEL,
    tools: [{ name: "bash" }],
    messages: [
      { role: "user", content: "fix the <system-reminder>noise</system-reminder>bug" },
    ],
  };
  const turn = claudeProvider.readTurn(body, "/v1/messages");
  assert.equal(turn.isSentinel, true);
  assert.equal(turn.promptText, "fix the bug");

  const continuation = {
    model: SENTINEL_MODEL,
    tools: [{ name: "bash" }],
    messages: [{ role: "user", content: [{ type: "tool_result", content: "done" }] }],
  };
  assert.equal(claudeProvider.readTurn(continuation, "/v1/messages").promptText, null);
});

test("treats a user-picked model as not routable", () => {
  const body = { model: "claude-opus-5", tools: [{ name: "bash" }], messages: [{ role: "user", content: "hi" }] };
  const turn = claudeProvider.readTurn(body, "/v1/messages");
  assert.equal(turn.isSentinel, false);
});

test("strips thinking and effort fields for the fast tier", () => {
  const body = { model: SENTINEL_MODEL, thinking: { type: "adaptive" }, output_config: { effort: "high" } };
  claudeProvider.applyTier(body, "/v1/messages", "fast", modelIdForTier("fast"));
  assert.equal(body.model, modelIdForTier("fast"));
  assert.equal(body.thinking, undefined);
  assert.equal(body.output_config, undefined);
});

test("drops a thinking-pruning context_management edit along with thinking itself", () => {
  const body = {
    model: SENTINEL_MODEL,
    thinking: { type: "adaptive" },
    context_management: { edits: [{ type: "clear_thinking_20251015" }, { type: "clear_tool_uses_20250919" }] },
  };
  claudeProvider.applyTier(body, "/v1/messages", "fast", modelIdForTier("fast"));
  assert.equal(body.thinking, undefined);
  assert.deepEqual(body.context_management.edits, [{ type: "clear_tool_uses_20250919" }]);
});

test("keeps thinking and effort for the strong tier", () => {
  const body = { model: SENTINEL_MODEL, thinking: { type: "adaptive" }, output_config: { effort: "high" } };
  claudeProvider.applyTier(body, "/v1/messages", "strong", modelIdForTier("strong"));
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.equal(body.output_config.effort, "high");
});

test("maps model ids back to tier names", () => {
  assert.equal(tierForModelId(modelIdForTier("fast")), "fast");
  assert.equal(tierForModelId(modelIdForTier("strong")), "strong");
  assert.equal(tierForModelId("something-unrelated"), null);
});
