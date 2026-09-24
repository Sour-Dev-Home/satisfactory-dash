import { z } from "zod";

/**
 * Where a completed login sends the browser back to (ADR-0025 decision 3): a RELATIVE path under
 * /app, and nothing else, so a login can never redirect off-site.
 *
 * ASCII only, by allowlist (RFC 3986 pchar characters, no backslash, no whitespace, no control
 * characters): any non-ASCII character simply fails, so nothing depends on how Postgres or a
 * browser classifies a Unicode line separator. The frontend percent-encodes everything else.
 *
 * ONE source of truth: this string is written into the `identity.login_attempts.return_path` CHECK
 * constraint verbatim (a test reads the migration and asserts the two agree), and the zod schema
 * below uses the same text, so the application and the database can never drift apart. Kept as a
 * string in the syntax both Postgres (POSIX ARE) and JavaScript accept.
 */
export const RETURN_PATH_REGEX_SOURCE =
  "^/app(/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)*(\\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?(#[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$";

export const RETURN_PATH_PATTERN = new RegExp(RETURN_PATH_REGEX_SOURCE);

/** The longest return path accepted (a URL length no browser truncates). Also a CHECK. */
export const RETURN_PATH_MAX_LENGTH = 2048;

export const ReturnPathSchema = z
  .string()
  .max(RETURN_PATH_MAX_LENGTH)
  .regex(RETURN_PATH_PATTERN)
  // Dot segments are refused too (also a CHECK): no legitimate return path needs "..".
  .refine((path) => !path.includes(".."), { message: "return path must not contain '..'" });
