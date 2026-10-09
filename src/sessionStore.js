// Per-session routing status, written so a status line or an explain command can show what
// the last turn actually ran on. One JSON file per session under the OS temp dir, so
// concurrent sessions never clobber each other and the OS eventually cleans them up.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = join(tmpdir(), "routecli");
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const fileFor = (sessionId) => join(DIR, `${sessionId.replace(/[^\w-]/g, "")}.json`);

export function writeSessionStatus(sessionId, status) {
  if (!sessionId) return;
  try {
    mkdirSync(DIR, { recursive: true, mode: DIR_MODE });
    const file = fileFor(sessionId);
    writeFileSync(file, JSON.stringify(status), { mode: FILE_MODE });
    chmodSync(file, FILE_MODE);
  } catch {
    // Status display is cosmetic; it must never break the actual request.
  }
}

export function readSessionStatus(sessionId) {
  try {
    return JSON.parse(readFileSync(fileFor(sessionId), "utf8"));
  } catch {
    return null;
  }
}

export const SESSION_DIR = DIR;
