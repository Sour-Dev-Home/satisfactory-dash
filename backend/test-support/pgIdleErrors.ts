import pg from "pg";

/**
 * Test harness only (issue #270): every `pg.Pool` and `pg.Client` a test creates gets an `error` listener.
 *
 * Why: the DB tests share one Postgres, and a file's teardown drops its database with `DROP DATABASE ... WITH (FORCE)` (and
 * the global teardown stops the container). Postgres then terminates every connection still open, and each idle pooled
 * client emits an `error` event (57P01 "terminating connection due to administrator command"). A `pg.Pool` with no `error`
 * listener turns that into an UNHANDLED error: Vitest reports it, and the run fails although every test passed (it bounced a
 * PR out of the merge queue twice). The production pool already has a listener (platform/db/pool.ts); the raw pools the
 * tests create did not. Attaching one here covers all of them without touching each test, whatever the teardown order.
 *
 * What it hides and what it does not: a shutdown code that a teardown produces (57P01, 57P02) is expected and silent. Any
 * other idle-connection error is still printed to stderr (the code only, never the message: it can quote a connection URL),
 * so a real problem stays visible; it just no longer crashes the run.
 */

const EXPECTED_AT_TEARDOWN = new Set(["57P01", "57P02"]);
const PATCHED = Symbol.for("satisfactory-dash.pgIdleErrorsPatched");

type ErrorSource = { on(event: "error", listener: (err: Error & { code?: string }) => void): unknown };

export function guardIdleErrors(target: ErrorSource): void {
  target.on("error", (err) => {
    const code = err.code ?? err.name;
    if (!EXPECTED_AT_TEARDOWN.has(code)) console.error(`[db test harness] idle database connection error: ${code}`);
  });
}

function patch<T extends new (...args: never[]) => ErrorSource>(Original: T): T {
  // `super(...args)` then attach: a subclass keeps every static and prototype member of the original.
  const Guarded = class extends (Original as unknown as new (...args: unknown[]) => ErrorSource) {
    constructor(...args: unknown[]) {
      super(...args);
      guardIdleErrors(this);
    }
  };
  return Guarded as unknown as T;
}

const holder = pg as unknown as Record<string | symbol, unknown>;
// The module object is shared by every test file a worker runs (pg is not re-evaluated per file): patch it once.
if (holder[PATCHED] !== true) {
  holder.Pool = patch(pg.Pool as unknown as new (...args: never[]) => ErrorSource);
  holder.Client = patch(pg.Client as unknown as new (...args: never[]) => ErrorSource);
  holder[PATCHED] = true;
}
