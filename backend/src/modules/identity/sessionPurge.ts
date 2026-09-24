import type { Queryable } from "../../platform/db/schemaVersion.js";
import { deleteExpiredLoginAttempts } from "./repositories/loginAttemptRepository.js";
import { deleteExpiredSessions } from "./repositories/sessionRepository.js";

/**
 * Retention housekeeping (privacy policy): sessions expired more than 30 days ago and stale
 * login attempts are purged at startup and then hourly, in small batches so a purge never holds a
 * long lock. A failure is logged and retried at the next tick; it never affects requests.
 */
export const PURGE_INTERVAL_MS = 60 * 60 * 1000;
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
export function createSessionPurgeWorker(db: Queryable, logger: PurgeLogger) {
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    try {
      const result = await purgeExpired(db);
      if (result.sessions > 0 || result.loginAttempts > 0) {
        logger.info(result, "purged expired sessions and login attempts");
      }
    } catch {
      logger.warn({}, "session purge failed; will retry at the next interval");
    }
  };
  return {
    start(): void {
      if (timer !== undefined) {
        return;
      }
      void run();
      timer = setInterval(() => void run(), PURGE_INTERVAL_MS);
      timer.unref();
    },
    async stop(): Promise<void> {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
