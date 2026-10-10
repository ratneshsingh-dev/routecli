#!/usr/bin/env node
// Status line for Claude Code. Claude pipes a JSON blob describing the session on stdin and
// renders whatever single line we print. Its own UI always shows the model it asked for
// (the routing sentinel), so this is the only place the actually-routed model is visible.
//
// This must never crash or hang: a broken status line would disrupt every prompt. Any
// failure prints nothing and exits cleanly.

import { readSessionStatus } from "../src/sessionStore.js";

const TIER_ICON = { fast: "⚡", balanced: "◆", strong: "★", deep: "▲" };

function render(status, session) {
  if (!status) return "routecli · waiting for first turn";
  if (status.manual) return "routecli · paused (model chosen manually)";

  const parts = [`${TIER_ICON[status.tier] ?? "•"} ${status.model ?? status.tier}`];
  if (typeof status.confidence === "number") parts.push(`p=${status.confidence.toFixed(2)}`);

  // Claude reports context use; surfacing it here saves a round trip to /context.
  const used = session?.exceeds_200k_tokens ? null : session?.context_used_percent;
  if (typeof used === "number") parts.push(`${Math.round(used)}% context`);

  return parts.join(" · ");
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let session = {};
  try {
    session = JSON.parse(raw);
  } catch {
    // Claude changed its payload, or there was none; fall back to a session-less line.
  }

  const sessionId = session?.session_id ?? session?.sessionId ?? "";
  process.stdout.write(render(readSessionStatus(sessionId), session));
}

main().catch(() => process.exit(0));
