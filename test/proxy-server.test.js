import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startRoutingProxy } from "../src/proxyServer.js";
import { geminiProvider, SENTINEL_MODEL, modelIdForTier } from "../src/providers/gemini.js";
import { readSessionStatus } from "../src/sessionStore.js";

test("routes a sentinel request through to the chosen model and forwards auth untouched", async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ url: req.url, apiKey: req.headers["x-goog-api-key"] });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const provider = { ...geminiProvider, upstreamBaseURL: () => `http://127.0.0.1:${upstream.address().port}` };
  const sessionId = `test-${process.pid}`;
  const { port, close } = await startRoutingProxy(provider, {
    sessionId,
    brain: async () => ({ tier: "strong", confidence: 0.9 }),
  });
  t.after(close);

  const response = await fetch(`http://127.0.0.1:${port}/v1beta/models/${SENTINEL_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": "secret-key" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "debug this race condition" }] }] }),
  }).then((r) => r.json());

  assert.equal(response.candidates[0].content.parts[0].text, "ok");
  assert.equal(seen[0].url, `/v1beta/models/${modelIdForTier("strong")}:generateContent`);
  assert.equal(seen[0].apiKey, "secret-key");

  const status = readSessionStatus(sessionId);
  assert.equal(status.tier, "strong");
  assert.equal(status.confidence, 0.9);
});

test("passes a manually chosen model straight through without calling the brain", async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push(req.url);
    res.end("{}");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const provider = { ...geminiProvider, upstreamBaseURL: () => `http://127.0.0.1:${upstream.address().port}` };
  let brainCalls = 0;
  const { port, close } = await startRoutingProxy(provider, {
    brain: async () => {
      brainCalls++;
      return { tier: "strong", confidence: 0.9 };
    },
  });
  t.after(close);

  await fetch(`http://127.0.0.1:${port}/v1beta/models/gemini-2.5-pro:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [] }),
  });

  assert.equal(brainCalls, 0);
  assert.equal(seen[0], "/v1beta/models/gemini-2.5-pro:generateContent");
});
