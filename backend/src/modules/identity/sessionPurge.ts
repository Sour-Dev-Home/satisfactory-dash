import type { Queryable } from "../../platform/db/schemaVersion.js";
import { ConfigError } from "../../platform/errors.js";
import { deleteExpiredLoginAttempts } from "./repositories/loginAttemptRepository.js";
import { deleteExpiredSessions } from "./repositories/sessionRepository.js";
import { purgeExpiredAuditEvents } from "../../platform/audit/auditRepository.js";

/**
 * Retention housekeeping (privacy policy): sessions expired more than 30 days ago and stale
 * login attempts are purged at startup and then hourly, in small batches so a purge never holds a
 * long lock. A failure is logged and retried at the next tick; it never affects requests.
 */
export const PURGE_INTERVAL_MS = 60 * 60 * 1000;
/** PURGE_START_DELAY_MS: how long the purge worker waits after the database startup check succeeded before
 *  its first run. Whole milliseconds, 0-600000; blank or unset means 30 s. */
export const DEFAULT_PURGE_START_DELAY_MS = 30_000;
export function loadPurgeStartDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const text = env.PURGE_START_DELAY_MS?.trim();
  if (!text) {
    return DEFAULT_PURGE_START_DELAY_MS;
  }
  const value = /^\d{1,6}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value > 600_000) {
    throw new ConfigError(`PURGE_START_DELAY_MS must be a whole number from 0 to 600000 (or unset for ${DEFAULT_PURGE_START_DELAY_MS}).`);
  }
  return value;
}

/** The audit trail is purged at most once a day. */
export const AUDIT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;
/** A safety bound per run, so a huge backlog is worked off over several ticks. */
const MAX_BATCHES_PER_RUN = 100;

export interface PurgeLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface PurgeResult {
  sessions: number;
  loginAttempts: number;
}

async function drain(deleteBatch: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const deleted = await deleteBatch();
    total += deleted;
    if (deleted < BATCH_SIZE) {
      break;
    }
  }
  return total;
}

/** One purge run. Exposed for tests and the admin CLI. */
export async function purgeExpired(db: Queryable): Promise<PurgeResult> {
  return {
    sessions: await drain(() => deleteExpiredSessions(db, BATCH_SIZE)),
    loginAttempts: await drain(() => deleteExpiredLoginAttempts(db, BATCH_SIZE)),
  };
}

/** A background worker with the same start/stop shape as the telemetry pollers. */
export function createSessionPurgeWorker(
  db: Queryable,
  logger: PurgeLogger,
  now: () => number = Date.now,
  options: { initialDelayMs?: number } = {},
) {
  let timer: NodeJS.Timeout | undefined;
  let delayTimer: NodeJS.Timeout | undefined;
  let started = false;
  const initialDelayMs = options.initialDelayMs ?? 0;
  let lastAuditPurge: number | undefined;
  const run = async () => {
    try {
      const result = await purgeExpired(db);
      if (result.sessions > 0 || result.loginAttempts > 0) {
        logger.info(result, "purged expired sessions and login attempts");
      }
    } catch {
      logger.warn({}, "session purge failed; will retry at the next interval");
    }
    // Audit events are kept one year (privacy policy). The runtime role cannot delete them, so this goes
    // through the narrow SECURITY DEFINER function; once a day is plenty, and a failure never affects
    // the session purge above or any request.
    if (lastAuditPurge === undefined || now() - lastAuditPurge >= AUDIT_PURGE_INTERVAL_MS) {
      try {
        const deleted = await purgeExpiredAuditEvents(db);
        lastAuditPurge = now();
        if (deleted > 0) {
          logger.info({ auditEvents: deleted }, "purged audit events older than one year");
        }
      } catch {
        logger.warn({}, "audit purge failed; will retry at the next interval");
      }
    }
  };
  return {
    /** The caller starts this only once the database startup check has succeeded (server.ts); the first
     *  run then waits `initialDelayMs` more, because a new process's first connections on the Windows host
     *  can be slow (issue #153). A later failure still warns exactly as before. */
    start(): void {
      if (started) {
        return;
      }
      started = true;
      const begin = () => {
        delayTimer = undefined;
        void run();
        timer = setInterval(() => void run(), PURGE_INTERVAL_MS);
        timer.unref();
      };
      if (initialDelayMs <= 0) {
        begin();
        return;
      }
      delayTimer = setTimeout(begin, initialDelayMs);
      delayTimer.unref();
    },
    async stop(): Promise<void> {
      started = false;
      if (delayTimer !== undefined) {
        clearTimeout(delayTimer);
        delayTimer = undefined;
      }
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
