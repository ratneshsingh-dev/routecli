// A loopback HTTP proxy that sits between a CLI and its real API. It is wire-format agnostic:
// everything that differs between Claude Code, Codex, and Gemini CLI — where the model id
// lives, how a "new turn" is recognised, which host to forward to — is supplied by a
// provider adapter (see src/providers/*.js). This file only owns the routing *decision*
// and the mechanics of piping bytes through unchanged otherwise.

import http from "node:http";
import https from "node:https";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { askBrain } from "./brain.js";
import { decideTier } from "./tiers.js";
import { writeSessionStatus } from "./sessionStore.js";

// The wrapped CLI owns the terminal, and writing to stderr underneath a full-screen TUI
// corrupts its prompt. So an interactive session logs to a file instead, and only a piped
// or non-interactive run (`-p`, CI) writes to stderr where it is actually readable.
export const DEBUG_LOG_FILE = join(homedir(), ".routecli.log");

const debugLog = (line) => {
  if (!process.env.ROUTECLI_DEBUG) return;
  const text = `[routecli] ${line}\n`;
  if (!process.stdout.isTTY) return void process.stderr.write(text);
  try {
    appendFileSync(DEBUG_LOG_FILE, `${new Date().toISOString()} ${text}`);
  } catch {
    // Unwritable home directory; a debug log is never worth failing a request over.
  }
};

/**
 * @param {object} provider  see src/providers/*.js for the shape this must implement
 * @param {object} [opts]
 * @param {(args: {prompt: string, currentTier: string, contextTokens: number}) => Promise<any>} [opts.brain]
 * @param {string} [opts.sessionId]  key routing decisions are published under for a status line
 */
export async function startRoutingProxy(provider, { brain = askBrain, sessionId = "" } = {}) {
  const conversations = new Map();

  const conversationState = (key) => {
    let state = conversations.get(key);
    if (!state) {
      if (conversations.size > 50) conversations.delete(conversations.keys().next().value);
      conversations.set(key, (state = { tier: null, modelId: null }));
    }
    return state;
  };

  const server = http.createServer((req, res) => {
    if (req.method === "HEAD") return res.writeHead(200).end();

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      let outgoingBody = Buffer.concat(chunks);
      let outgoingUrl = req.url ?? "/";

      if (provider.isRoutableRequest(req.method, req.url ?? "")) {
        try {
          const parsedBody = outgoingBody.length ? JSON.parse(outgoingBody.toString("utf8")) : {};
          const turn = provider.readTurn(parsedBody, outgoingUrl);

          // A status line reads this file, and it only knows the CLI's own session id, so
          // prefer the key the provider dug out of the request over our process-level one.
          const statusKey = turn?.statusKey || sessionId;

          if (turn && !turn.isSentinel) {
            // The CLI (or the user through /model) picked a real model itself; an explicit
            // choice always wins and nothing here should be rewritten.
            if (turn.promptText) writeSessionStatus(statusKey, { manual: true, at: Date.now() });
          } else if (turn) {
            const key = turn.conversationId;
            const state = conversationState(key);
            const availableTiers = provider.availableTiers();
            // Start on the middle tier rather than the top one. This is the baseline an
            // uncertain answer falls back to, and anchoring that at the most expensive model
            // meant every unsure first turn paid top rates.
            const currentTier = state.tier ?? (availableTiers.includes("balanced")
              ? "balanced"
              : availableTiers[availableTiers.length - 1]);
            const currentModelId = state.modelId ?? provider.modelIdForTier(currentTier);

            let decision = { tier: currentTier, reason: "no-new-turn" };
            let brainAnswer = null;
            if (turn.promptText) {
              const contextTokens = provider.estimateContextTokens?.(parsedBody) ?? 0;
              brainAnswer = await brain({
                prompt: turn.promptText,
                currentTier,
                contextTokens,
              });
              decision = decideTier({
                promptText: turn.promptText,
                brainAnswer,
                currentTier,
                availableTiers,
                contextTokens,
              });
            }

            const modelId = provider.modelIdForTier(decision.tier);

            if (turn.promptText) {
              debugLog(
                `${key} ${brainAnswer ? `p=${brainAnswer.confidence.toFixed(2)}` : "no-brain"} ` +
                  `${currentTier} -> ${decision.tier} (${decision.reason}) served by ${modelId}`,
              );
            }
            state.tier = decision.tier;
            state.modelId = modelId;

            // Written after the model is resolved so the status line can name it, and on
            // every routed request so a status line opened mid-session still has something.
            if (turn.promptText) {
              writeSessionStatus(statusKey, {
                tier: decision.tier,
                model: modelId,
                confidence: brainAnswer?.confidence ?? null,
                reason: decision.reason,
                at: Date.now(),
              });
            }

            const applied = provider.applyTier(parsedBody, outgoingUrl, decision.tier, modelId);
            outgoingBody = Buffer.from(JSON.stringify(applied.body));
            outgoingUrl = applied.url ?? outgoingUrl;
          }
        } catch (err) {
          debugLog(`passthrough, could not process body: ${err.message}`);
        }
      }

      const base = new URL(provider.upstreamBaseURL(req.headers, outgoingUrl));
      const transport = base.protocol === "http:" ? http : https;
      const headers = { ...req.headers, host: base.host };
      delete headers["content-length"];

      const upstream = transport.request(
        {
          hostname: base.hostname,
          port: base.port || undefined,
          path: `${base.pathname.replace(/\/$/, "")}${outgoingUrl}`,
          method: req.method,
          headers,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstream.on("error", (err) => {
        debugLog(`upstream error: ${err.message}`);
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: err.message } }));
      });
      if (outgoingBody.length) upstream.write(outgoingBody);
      upstream.end();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, close: () => server.close() };
}
