// Shared bits every provider's launch step needs: pulling JEV_API_KEY out of a config file,
// and finding a CLI binary on PATH without going through a shell (so arguments never need
// quoting and a missing install produces a clear message instead of "command not found").

import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function loadConfigFile() {
  for (const file of [join(process.cwd(), ".env"), join(homedir(), ".routecli.env")]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing or unreadable; the key may still already be in the real environment.
    }
  }
}

export function findOnPath(command) {
  const isWindows = process.platform === "win32";
  // PATHEXT omits .ps1, but npm-installed CLIs often ship one, so it is appended explicitly.
  const extensions = isWindows
    ? [...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";"), ".ps1"]
    : [""];
  // Windows has no executable bit, so X_OK there would reject files that run fine.
  const mode = isWindows ? constants.F_OK : constants.X_OK;
  const dirs = (process.env.PATH ?? "").split(isWindows ? ";" : ":");
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir.replace(/^"|"$/g, ""), `${command}${ext}`);
      try {
        accessSync(candidate, mode);
        if (/\.ps1$/i.test(candidate)) {
          // Node cannot execute a PowerShell script directly; run it through the host.
          return { path: "powershell.exe", prefix: ["-NoProfile", "-File", candidate], needsShell: false };
        }
        return { path: candidate, prefix: [], needsShell: /\.(cmd|bat)$/i.test(candidate) };
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

/**
 * Under `shell: true` Node flattens arguments into a single command line, so anything
 * containing whitespace has to be quoted or the shell splits it into separate arguments.
 */
export function quoteForShell(args) {
  return args.map((arg) => (/\s/.test(arg) && !/^".*"$/.test(arg) ? `"${arg}"` : arg));
}

export function hasRoutingKey() {
  return Boolean(process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY);
}
