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
  const extensions = isWindows ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  const dirs = (process.env.PATH ?? "").split(isWindows ? ";" : ":");
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir.replace(/^"|"$/g, ""), `${command}${ext}`);
      try {
        accessSync(candidate, constants.X_OK);
        return { path: candidate, needsShell: /\.(cmd|bat)$/i.test(candidate) };
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

export function hasRoutingKey() {
  return Boolean(process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY);
}
