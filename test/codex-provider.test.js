import test from "node:test";
import assert from "node:assert/strict";
import { codexProvider, SENTINEL_MODEL, modelIdForTier, tierForModelId } from "../src/providers/codex.js";

test("recognises the Responses endpoint as routable", () => {
  assert.equal(codexProvider.isRoutableRequest("POST", "/responses"), true);
  assert.equal(codexProvider.isRoutableRequest("GET", "/responses"), false);
});

test("picks the ChatGPT backend for a subscription login, the public API otherwise", () => {
  assert.equal(
    codexProvider.upstreamBaseURL({ "chatgpt-account-id": "acct" }),
    "https://chatgpt.com/backend-api/codex",
  );
  assert.equal(codexProvider.upstreamBaseURL({ authorization: "Bearer sk-test" }), "https://api.openai.com/v1");
});

test("reads a fresh user turn out of the input array", () => {
  const body = {
    model: SENTINEL_MODEL,
    input: [
      { type: "additional_tools", role: "developer", tools: [{}] },
      { role: "user", content: [{ type: "input_text", text: "fix the failing test" }] },
    ],
  };
  const turn = codexProvider.readTurn(body, "/responses");
  assert.equal(turn.isSentinel, true);
  assert.equal(turn.promptText, "fix the failing test");
});

test("ignores a tool-output continuation", () => {
  const body = {
    model: SENTINEL_MODEL,
    input: [
      { type: "additional_tools", role: "developer", tools: [{}] },
      { role: "user", content: "fix the failing test" },
      { type: "function_call_output", call_id: "1", output: "done" },
    ],
  };
  assert.equal(codexProvider.readTurn(body, "/responses").promptText, null);
});

test("builds the custom provider flags and skips them when the user already picked a model", () => {
  const launch = codexProvider.buildLaunch({ proxyBaseURL: "http://127.0.0.1:1234", forwardedArgs: [] });
  assert.deepEqual(launch.extraArgs.slice(0, 2), ["--model", SENTINEL_MODEL]);
  assert(launch.extraArgs.includes('model_providers.routecli.requires_openai_auth=true'));

  const withOwnModel = codexProvider.buildLaunch({
    proxyBaseURL: "http://127.0.0.1:1234",
    forwardedArgs: ["--model", "gpt-5"],
  });
  assert.equal(withOwnModel.extraArgs.includes("--model"), false);
});

test("maps model ids back to tier names", () => {
  assert.equal(tierForModelId(modelIdForTier("fast")), "fast");
  assert.equal(tierForModelId(modelIdForTier("strong")), "strong");
});
