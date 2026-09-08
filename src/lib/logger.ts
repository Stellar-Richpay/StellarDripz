/**
 * Structured logger for production monitoring.
 * Supports log levels and structured JSON output.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
  stack?: string;
}

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatEntry(entry: LogEntry): string {
  if (typeof window !== "undefined") {
    // Client-side: compact console output. Include the error/context so a
    // browser console shows the same detail a structured log would.
    const parts = [`[${entry.level.toUpperCase()}] ${entry.timestamp} ${entry.message}`];
    if (entry.error) parts.push(`error=${entry.error}`);
    if (entry.context) parts.push(JSON.stringify(entry.context));
    return parts.join(" ");
  }
  // Server-side: structured JSON
  return JSON.stringify(entry);
}

/**
 * Normalize the trailing arguments into a context/error pair.
 *
 * error() accepts `(msg, err?, ctx?)` while the other levels take
 * `(msg, ctx?)`. That asymmetry is a footgun: passing a plain object as
 * error()'s second argument would silently land in the `error` field and
 * the context would be lost. Detect Error instances wherever they appear
 * and route plain objects to context, so both call shapes behave sensibly.
 */
function normalizeArgs(
  a?: Record<string, unknown> | Error,
  b?: Record<string, unknown> | Error,
): { context?: Record<string, unknown>; err?: Error } {
  if (a instanceof Error) {
    return { context: b as Record<string, unknown> | undefined, err: a };
  }
  if (b instanceof Error) {
    return { context: a as Record<string, unknown> | undefined, err: b };
  }
  // Both are plain objects (or undefined): the second call shape, `(msg, ctx)`.
  return { context: (a ?? b) as Record<string, unknown> | undefined };
}

function log(
  level: LogLevel,
  message: string,
  a?: Record<string, unknown> | Error,
  b?: Record<string, unknown> | Error,
): void {
  if (!shouldLog(level)) return;

  const { context, err } = normalizeArgs(a, b);

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
    error: err?.message,
    stack: err?.stack,
  };

  const formatted = formatEntry(entry);

  switch (level) {
    case "debug":
      console.debug(formatted);
      break;
    case "info":
      console.info(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log("warn", msg, ctx),
  error: (
    msg: string,
    errOrCtx?: Error | Record<string, unknown>,
    ctx?: Error | Record<string, unknown>,
  ) => log("error", msg, errOrCtx, ctx),
};
