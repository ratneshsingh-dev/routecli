#!/usr/bin/env node
// Entry point: `routecli <provider> [args...]` launches the real CLI for that provider,
// started through a local routing proxy when a routing key is configured.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { startRoutingProxy } from "../src/proxyServer.js";
import { loadConfigFile, hasRoutingKey, quoteForShell } from "../src/launcher.js";
import { claudeProvider } from "../src/providers/claude.js";
import { codexProvider } from "../src/providers/codex.js";
import { geminiProvider } from "../src/providers/gemini.js";

const PROVIDERS = {
  claude: claudeProvider,
  codex: codexProvider,
  gemini: geminiProvider,
};

const [providerName, ...rest] = process.argv.slice(2);

if (!providerName || !PROVIDERS[providerName]) {
  process.stderr.write(
    `Usage: routecli <${Object.keys(PROVIDERS).join("|")}> [CLI arguments...]\n\n` +
      "Launches the real CLI for that provider and, when a routing key is configured,\n" +
      "transparently routes each turn to the cheapest model that can handle it.\n",
  );
  process.exit(providerName ? 1 : 0);
}

const provider = PROVIDERS[providerName];

loadConfigFile();

const binary = provider.locateBinary();
if (!binary) {
  process.stderr.write(
    `[routecli] \`${provider.binaryName}\` is not installed, or not on your PATH.\n` +
      `[routecli] routecli runs the real ${provider.binaryName} CLI; install it first.\n`,
  );
  process.exit(1);
}

let close = () => {};
let args = rest;
const env = { ...process.env };

if (hasRoutingKey()) {
  const sessionId = `${providerName}-${process.pid}`;
  const proxy = await startRoutingProxy(provider, { sessionId });
  close = proxy.close;
  const { env: launchEnv, extraArgs } = provider.buildLaunch({
    proxyBaseURL: `http://127.0.0.1:${proxy.port}`,
    forwardedArgs: rest,
  });
  Object.assign(env, launchEnv);
  args = [...rest, ...extraArgs];
} else {
  process.stderr.write(
    "[routecli] no JEV_API_KEY found - starting without routing\n" +
      `[routecli] add JEV_API_KEY=... to ${join(homedir(), ".routecli.env")} to enable it\n`,
  );
}

const childArgs = [...binary.prefix, ...args];
const child = spawn(binary.path, binary.needsShell ? quoteForShell(childArgs) : childArgs, {
  stdio: "inherit",
  shell: binary.needsShell,
  env,
});

child.on("error", (err) => {
  close();
  process.stderr.write(`[routecli] could not start ${provider.binaryName}: ${err.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  close();
  process.exit(signal ? 1 : (code ?? 0));
});
