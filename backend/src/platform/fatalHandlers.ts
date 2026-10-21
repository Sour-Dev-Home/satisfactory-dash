/**
 * #560 (OWASP A10): a crash leaves one JSON `fatal` line (pino level 60), not a plain-text stack trace the CloudWatch
 * JSON filters cannot match. An uncaught exception or an unhandled promise rejection is logged with its error, the log is
 * flushed, and the process exits 1, so the supervisor (ECS, or the Scheduled Task wrapper on the game PC) restarts it.
 * Nothing is swallowed: the process never carries on in an unknown state.
 */
export const UNCAUGHT_EXCEPTION_MSG = "uncaught exception; exiting";
export const UNHANDLED_REJECTION_MSG = "unhandled promise rejection; exiting";
/** How long the flush may take before the process exits anyway. */
export const FATAL_FLUSH_TIMEOUT_MS = 2_000;

export interface FatalLogger {
  fatal(obj: object, msg: string): void;
  flush(cb?: (err?: Error) => void): void;
}

export interface FatalHandlerDeps {
  logger: FatalLogger;
  /** `process.exit` in production; tests pass a spy. */
  exit: (code: number) => void;
  /** Where the handlers are registered (`process` in production). */
  target: { on(event: "uncaughtException" | "unhandledRejection", listener: (reason: unknown) => void): unknown };
  flushTimeoutMs?: number;
}

export function installFatalHandlers(deps: FatalHandlerDeps): void {
  let exiting = false;
  const die = (reason: unknown, code: string, msg: string) => {
    if (exiting) return; // a second failure while flushing: the first one is already on its way out
    exiting = true;
    try {
      deps.logger.fatal({ err: reason, code }, msg);
    } catch {
      // A logger that cannot write must not keep the process alive.
    }
    let done = false;
    const exit = () => {
      if (done) return;
      done = true;
      deps.exit(1);
    };
    // Not unref'd: this timer is what guarantees the exit if the flush never calls back.
    setTimeout(exit, deps.flushTimeoutMs ?? FATAL_FLUSH_TIMEOUT_MS);
    try {
      deps.logger.flush(() => exit());
    } catch {
      exit();
    }
  };
  deps.target.on("uncaughtException", (err) => die(err, "UNCAUGHT_EXCEPTION", UNCAUGHT_EXCEPTION_MSG));
  deps.target.on("unhandledRejection", (reason) => die(reason, "UNHANDLED_REJECTION", UNHANDLED_REJECTION_MSG));
}
