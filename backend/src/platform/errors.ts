/** Set on upstream errors so callers (platform/errorResponse.ts) can tell
 *  "the server couldn't be reached" apart from "it answered with something
 *  unusable" without importing adapter-specific error classes. Absent means the
 *  adapter didn't classify it (e.g. an HTTP status error, which carries `status`). */
export type RequestFailureKind = "unreachable" | "invalid_response";

/**
 * Base class for every error that means "the game server (or the path to it) failed":
 * transport failures, HTTP error statuses, vanilla-API error bodies, and responses that
 * fail raw-schema validation. platform/errorResponse.ts maps ONLY these to upstream_*
 * codes (502/503). Any other error, even one with a numeric `status`, is treated as our
 * own failure and fails closed (400 for a client's bad request, else 500), never a 502
 * by default (architect ruling, PR 3).
 */
export class UpstreamError extends Error {
  readonly failureKind?: RequestFailureKind;
  /** The game server's HTTP status, when it answered with one. */
  readonly status?: number;
  /** The vanilla API's own error code, from an Error Response body. */
  readonly errorCode?: string;

  constructor(
    message: string,
    options?: ErrorOptions & { failureKind?: RequestFailureKind; status?: number; errorCode?: string },
  ) {
    super(message, options);
    this.name = "UpstreamError";
    this.failureKind = options?.failureKind;
    this.status = options?.status;
    this.errorCode = options?.errorCode;
  }
}

/** A configuration the backend refuses to start with. server.ts reports it and exits.
 *  Shared by every module's config loader (gameserver, servers, identity). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
