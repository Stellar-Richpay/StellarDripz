/**
 * Shared environment variable loader for standalone scripts.
 * Reads .env.local and .env files without requiring Next.js boot or dotenv.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

export function loadEnv(): void {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  loadEnvFile(resolve(process.cwd(), ".env"));
}

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      // Strip a shell-style `export ` prefix (common in .env files written
      // for `source`) — without this the whole "export FOO=bar" line became
      // a key named "export FOO" that silently loaded nothing.
      const trimmed = line.trim().replace(/^export\s+/i, "");
      // Skip blank lines, comments, and anything before the first '='.
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Drop an inline comment, honoring quotes: `KEY=foo # comment` keeps
      // the comment out of the value, but `KEY="foo # bar"` keeps it in.
      const quoteChar = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : null;
      if (quoteChar) {
        const closeIdx = value.indexOf(quoteChar, 1);
        if (closeIdx !== -1) value = value.slice(1, closeIdx);
      } else {
        const commentIdx = value.indexOf(" #");
        if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
      }
      if (!process.env[key]) process.env[key] = value.trim();
    }
  } catch {
    /* file not found */
  }
}
