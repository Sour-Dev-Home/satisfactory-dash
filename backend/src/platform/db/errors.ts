import { ConfigError } from "../errors.js";

/**
 * Central pg error mapping (ADR-0025 decisions 2 and 6). Repositories and the startup code ask
 * these helpers instead of comparing SQLSTATE codes in place.
 */

/** The error's `code` (a SQLSTATE like "23505" or a Node code like "ECONNREFUSED"), if any. */
export function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** A unique constraint (or primary key) rejected the write: map to a 409 `conflict` where a
 *  constraint expresses a business rule (e.g. the one-owner partial unique index). */
export function isUniqueViolation(err: unknown): boolean {
  return errorCode(err) === "23505";
}

/** The name of the unique constraint or index a 23505 violated (pg puts it in `constraint`),
 *  so a repository can tell "already a member" from "the server already has an owner". */
export function uniqueViolationConstraint(err: unknown): string | undefined {
  if (!isUniqueViolation(err)) {
    return undefined;
  }
  const constraint = (err as { constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : undefined;
}

/** A foreign key rejected the write (23503): the row it points at does not exist. */
export function isForeignKeyViolation(err: unknown): boolean {
  return errorCode(err) === "23503";
}

/** Node codes for "could not reach or lost the server", worth retrying at startup. */
const TRANSIENT_NODE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  // A temporary DNS failure and an unreachable network are what a machine that is still booting
  // reports; a genuinely unknown host is ENOTFOUND, which stays fatal.
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/** SQLSTATEs that mean the server is there but not ready or going away: 57P03 "the database
 *  system is starting up" (the boot race), 57P01/57P02 admin or crash shutdown, 53300 too many
 *  connections, 08xxx connection exceptions. */
function isTransientSqlState(code: string): boolean {
  // 08P01 (protocol violation) is a bug or a misconfigured server, not an outage.
  return code === "57P03" || code === "57P01" || code === "57P02" || code === "53300" || (code.startsWith("08") && code !== "08P01");
}

/** pg reports its own connect timeout and an early close without a code. */
function isTransientMessage(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /connection terminated|connection timeout|timeout exceeded when trying to connect|query read timeout/i.test(message);
}

function innerErrors(err: unknown): unknown[] {
  return typeof err === "object" && err !== null && "errors" in err && Array.isArray((err as { errors: unknown }).errors)
    ? (err as { errors: unknown[] }).errors
    : [];
}

/** The database is (probably) temporarily unavailable, as opposed to misconfigured. An
 *  AggregateError (dual-stack connect) is transient only if every attempt was. */
export function isTransientConnectionError(err: unknown): boolean {
  const inner = innerErrors(err);
  if (inner.length > 0) {
    return inner.every(isTransientConnectionError);
  }
  const code = errorCode(err);
  if (code !== undefined) {
    return TRANSIENT_NODE_CODES.has(code) || isTransientSqlState(code);
  }
  return isTransientMessage(err);
}

/**
 * The database could not answer a runtime request (unreachable, dropped, a statement or pool
 * timeout, a pool that was ended): the request should get a 503, never a 401 or a 500 that hides
 * the outage (ADR-0025 decision 6). A constraint violation or a bug is NOT this.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  if (isTransientConnectionError(err) || errorCode(err) === "57014") {
    return true;
  }
  const message = err instanceof Error ? err.message : "";
  return /Cannot use a pool after calling end|timeout exceeded when trying to connect|Query read timeout|Connection terminated/i.test(
    message,
  );
}

/** What to do with the first connection error at startup. */
export type StartupErrorClass =
  | { kind: "transient"; reason: string }
  | { kind: "fatal"; reason: string };

/** Fatal reasons are fixed strings: never the driver's message, which may quote the URL. */
const FATAL_REASONS: Record<string, string> = {
  "28P01": "the database rejected the credentials in DATABASE_URL",
  "28000": "the database rejected the credentials in DATABASE_URL",
  "3D000": "the database named in DATABASE_URL does not exist (run the database setup first)",
  ENOTFOUND: "the host in DATABASE_URL could not be resolved",
};

export function classifyStartupError(err: unknown): StartupErrorClass {
  if (err instanceof DatabaseSetupError) {
    return { kind: "fatal", reason: err.message };
  }
  if (isTransientConnectionError(err)) {
    const code = errorCode(err) ?? innerErrors(err).map(errorCode).find((c) => c !== undefined);
    return { kind: "transient", reason: code ? `the database is not reachable yet (${code})` : "the database is not reachable yet" };
  }
  const code = errorCode(err) ?? innerErrors(err).map(errorCode).find((c) => c !== undefined);
  if (code !== undefined && FATAL_REASONS[code]) {
    return { kind: "fatal", reason: FATAL_REASONS[code] };
  }
  // Anything unrecognized fails fast: better a clear exit than an endless retry loop.
  return { kind: "fatal", reason: `an unexpected database error${code ? ` (${code})` : ""}` };
}

/** A database problem the operator must fix (schema behind the build, bad setup). A ConfigError,
 *  so the composition root logs it and exits 1 like every other startup misconfiguration. */
export class DatabaseSetupError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseSetupError";
  }
}
