/**
 * #560: an uncaught exception or an unhandled promise rejection ends the agent with exit code 1 and one line on stderr,
 * like main()'s own catch. No detail is printed: an error here could carry a token or a snapshot body (agent/CLAUDE.md,
 * Logs). Nothing is swallowed: the agent never carries on in an unknown state; the Scheduled Task restarts it.
 */
export const FATAL_LINE = "The agent stopped unexpectedly.\n";

export interface FatalDeps {
  target: { on(event: "uncaughtException" | "unhandledRejection", listener: () => void): unknown };
  err: (line: string) => void;
  exit: (code: number) => void;
}

export function installFatalHandlers(deps: FatalDeps): void {
  let exiting = false;
  const die = () => {
    if (exiting) return;
    exiting = true;
    try {
      deps.err(FATAL_LINE);
    } catch {
      // stderr gone (a closed pipe): exiting matters more than the line.
    }
    deps.exit(1);
  };
  deps.target.on("uncaughtException", die);
  deps.target.on("unhandledRejection", die);
}
