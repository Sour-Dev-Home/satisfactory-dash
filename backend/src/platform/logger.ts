import pino from "pino";
import type { DestinationStream, Logger } from "pino";
import { DailyLogStream } from "./logFiles.js";

/**
 * ADR-0008: structured JSON logs to stdout (on AWS, container stdout goes to CloudWatch
 * Logs with no code change). On the game PC, LOG_DIR sends them to daily files instead, kept
 * 14 days (logFiles.ts). Full error detail goes here, never to a client outside
 * dev/test. Never log tokens, passwords, cookies or GetServerOptions output; the
 * redact paths below cover what pino-http serializes from each request/response.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-frm-authorization"]',
  'res.headers["set-cookie"]',
  // A Location can carry secrets (the Google sign-in redirect holds state, nonce and code_challenge) and has
  // little diagnostic value anywhere: redacted globally so a future auth route cannot forget it.
  "res.headers.location",
  // ADR-0029: player names are personal data about people who are not our users. The players
  // payload is never logged on purpose; these paths are the safety net if a log call ever includes
  // it (`players`, or nested one level: `{ data: { players } }`, `{ res: { players } }`).
  "players",
  "*.players",
  "*.*.players",
];

function defaultLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  // Vitest sets NODE_ENV=test; tests that assert on logs pass their own level.
  return process.env.NODE_ENV === "test" ? "silent" : "info";
}

/**
 * `logDir` (from resolveLogDir, i.e. LOG_DIR) sends the logs to daily files with a 14-day
 * retention instead of stdout; an explicit `destination` (tests) wins over it.
 */
export function createLogger(
  options: { level?: string; logDir?: string } = {},
  destination?: DestinationStream,
): Logger {
  const target = destination ?? (options.logDir ? new DailyLogStream({ dir: options.logDir }) : undefined);
  return pino(
    {
      level: options.level ?? defaultLevel(),
      redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    },
    target,
  );
}
