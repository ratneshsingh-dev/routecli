import test from "node:test";
import assert from "node:assert/strict";
import { quoteForShell } from "../src/launcher.js";
import { codexProvider } from "../src/providers/codex.js";

test("quotes arguments containing whitespace for shell invocation", () => {
  assert.deepEqual(
    quoteForShell(["-p", "fix the failing test"]),
    ["-p", '"fix the failing test"'],
  );
});

test("leaves whitespace-free arguments untouched", () => {
  assert.deepEqual(quoteForShell(["--resume", "codex"]), ["--resume", "codex"]);
});

test("does not double-quote an argument that is already quoted", () => {
  assert.deepEqual(quoteForShell(['"already quoted"']), ['"already quoted"']);
});

test("Codex config flags carry no spaces, so no quoting is needed", () => {
  // Nested quotes (a quoted value containing a space) are mangled by cmd.exe, so the
  // provider flags are built without spaces rather than relying on quoting to survive.
  const flags = codexProvider.buildLaunch({ proxyBaseURL: "http://127.0.0.1:1234" }).extraArgs;
  for (const flag of flags) assert.equal(/\s/.test(flag), false, `flag has whitespace: ${flag}`);
  assert.deepEqual(quoteForShell(flags), flags);
});
