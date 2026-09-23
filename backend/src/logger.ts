import pino from "pino";
import type { DestinationStream, Logger } from "pino";

/**
 * ADR-0008: structured JSON logs to stdout (on AWS, container stdout goes to CloudWatch
 * Logs with no code change). Full error detail goes here, never to a client outside
 * dev/test. Never log tokens, passwords, cookies or GetServerOptions output; the
 * redact paths below cover what pino-http serializes from each request/response.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-frm-authorization"]',
  'res.headers["set-cookie"]',
];

function defaultLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  // Vitest sets NODE_ENV=test; tests that assert on logs pass their own level.
  return process.env.NODE_ENV === "test" ? "silent" : "info";
}

export function createLogger(options: { level?: string } = {}, destination?: DestinationStream): Logger {
  return pino(
    {
      level: options.level ?? defaultLevel(),
      redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    },
    destination,
  );
}
