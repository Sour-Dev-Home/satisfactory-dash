/**
 * Connection config for a single Satisfactory dedicated server: the typed shape the adapter is built from.
 * Assembling it from environment variables or a servers file is the caller's job (the backend's
 * modules/gameserver/connectionConfig.ts); this package never reads the environment.
 */
export interface SatisfactoryServerConfig {
  host: string;
  /** Vanilla Dedicated Server HTTPS API port. Always TLS, self-signed by default
   *  (docs-vault/raw-sources/dedicated-server-api.md, "Certificate Validation and
   *  Encryption"). */
  apiPort: number;
  /** Bearer token for admin-privileged vanilla API functions. Not required for the
   *  read-only functions this adapter currently calls (HealthCheck, QueryServerState). */
  apiToken?: string;
  /** Accept the vanilla API's self-signed cert (the game server's default). Off unless
   *  the host is loopback/private or the operator explicitly opts out. */
  apiAllowSelfSignedCert: boolean;
  /** FicsitRemoteMonitoring Web Server port (default 8080 per
   *  docs-vault/raw-sources/frm-config.md). Confirmed live in the Phase 2 spike — see
   *  docs-vault/wiki/frm-api.md — that FRM's documented tunneled-transport fallback
   *  through apiPort does not work on this game/FRM version, so the adapter talks to
   *  this port directly. */
  frmPort: number;
  /** Sent as the `X-FRM-Authorization` header per
   *  docs-vault/raw-sources/frm-authentication.md. [NEEDS VERIFICATION] — not
   *  live-tested against an instance that actually enforces the token; the Phase 2
   *  spike's server accepted requests with no token at all. */
  frmToken?: string;
  requestTimeoutMs: number;
  /**
   * ADR-0032 step 1: called once per request to the game server (either API), success or failure, with how long it took.
   * The backend uses it to split a request's time into "app" and "upstream". The package only reports; it never knows who
   * listens, and a listener that throws never affects the request.
   */
  onUpstreamCall?: UpstreamCallListener;
}

/** One timed request to the game server: which API (`vanilla` = the dedicated-server HTTPS API, `frm` = FicsitRemoteMonitoring)
 *  and when it ran, in `performance.now()` milliseconds (a monotonic clock), so overlapping calls can be merged. */
export interface UpstreamCall {
  upstream: "vanilla" | "frm";
  startMs: number;
  endMs: number;
}
export type UpstreamCallListener = (call: UpstreamCall) => void;

export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/**
 * ADR-0030: the config for a server whose connection is stored in the database. `host` is the pinned
 * address (already validated as loopback or private by the address guard), so the vanilla API's
 * self-signed certificate is accepted, as it is for any loopback/private host; the timeout is the default.
 */
export function createSatisfactoryServerConfig(input: {
  host: string;
  apiPort: number;
  apiToken: string;
  frmPort: number;
  frmToken?: string;
}): SatisfactoryServerConfig {
  return {
    host: input.host,
    apiPort: input.apiPort,
    apiToken: input.apiToken,
    apiAllowSelfSignedCert: true,
    frmPort: input.frmPort,
    frmToken: input.frmToken,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };
}
