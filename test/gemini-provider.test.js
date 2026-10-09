import test from "node:test";
import assert from "node:assert/strict";
import { geminiProvider, SENTINEL_MODEL, modelIdForTier, tierForModelId } from "../src/providers/gemini.js";

test("recognises generateContent and streamGenerateContent as routable", () => {
  assert.equal(geminiProvider.isRoutableRequest("POST", `/v1beta/models/${SENTINEL_MODEL}:generateContent`), true);
  assert.equal(
    geminiProvider.isRoutableRequest("POST", `/v1beta/models/${SENTINEL_MODEL}:streamGenerateContent?alt=sse`),
    true,
  );
  assert.equal(geminiProvider.isRoutableRequest("GET", "/v1beta/models"), false);
});

test("reads the model out of the URL path, not the body", () => {
  const url = `/v1beta/models/${SENTINEL_MODEL}:generateContent?key=abc`;
  const body = { contents: [{ role: "user", parts: [{ text: "fix the typo" }] }] };
  const turn = geminiProvider.readTurn(body, url);
  assert.equal(turn.isSentinel, true);
  assert.equal(turn.promptText, "fix the typo");
});

test("treats a concrete model in the URL as a manual choice", () => {
  const url = "/v1beta/models/gemini-2.5-pro:generateContent?key=abc";
  const turn = geminiProvider.readTurn({ contents: [] }, url);
  assert.equal(turn.isSentinel, false);
});

test("ignores a function-response continuation", () => {
  const url = `/v1beta/models/${SENTINEL_MODEL}:generateContent`;
  const body = { contents: [{ role: "user", parts: [{ functionResponse: { name: "x", response: {} } }] }] };
  assert.equal(geminiProvider.readTurn(body, url).promptText, null);
});

test("rewrites the model segment of the URL, preserving the query string", () => {
  const url = `/v1beta/models/${SENTINEL_MODEL}:streamGenerateContent?alt=sse&key=abc`;
  const result = geminiProvider.applyTier({}, url, "strong", modelIdForTier("strong"));
  assert.equal(result.url, `/v1beta/models/${modelIdForTier("strong")}:streamGenerateContent?alt=sse&key=abc`);
});

test("maps model ids back to tier names", () => {
  assert.equal(tierForModelId(modelIdForTier("fast")), "fast");
  assert.equal(tierForModelId(modelIdForTier("balanced")), "balanced");
  assert.equal(tierForModelId(modelIdForTier("strong")), "strong");
});
