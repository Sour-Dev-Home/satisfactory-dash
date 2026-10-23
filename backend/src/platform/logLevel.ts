/**
 * One rule for the level of a request-related log line, so error tracking and any log-based
 * alerting see only real failures (architect request):
 *  - 5xx, or an error with no error status: `error`
 *  - 401: `info` (the frontend asks routinely while signed out, "Sign in to continue")
 *  - the readiness probe's 503 (no error thrown): `warn`, it is expected during startup
 *  - a 503 upstream_unreachable: `warn`, the agent or its game server failed, not the backend
 *  - 429 and every other 4xx: `warn`
 *  - everything else: `info`
 * A thrown error that maps to a 4xx (a handled client error such as a bad request) is NOT an
 * `error`: only the status decides.
 */
export type RequestLogLevel = "error" | "warn" | "info";

/** The readiness probe's 503 is an expected answer while the process starts (the database is still connecting), so a
 *  deploy does not look like an error. Only this exact path and no thrown error: any other 503 is still an `error`. */
const READINESS_PATH = "/api/health/ready";

/** An agent that has not reported since the backend started, or a game server its agent cannot reach: the outside world
 *  failed, not the backend. Every fresh task answers it until the agent's next report, and counting it as an error
 *  tripped backend-errors and rolled back the first automatic deploy. Only with a 503; the error handler records the code
 *  on `res.locals.errorCode` so the request line (pino-http) sees it too. */
export const UPSTREAM_UNREACHABLE = "upstream_unreachable";

export function requestLogLevel(status: number, err?: unknown, url?: string, code?: unknown): RequestLogLevel {
  if (status === 503 && (err === undefined || err === null) && url?.split("?")[0] === READINESS_PATH) {
    return "warn";
  }
  if (status === 503 && code === UPSTREAM_UNREACHABLE) {
    return "warn";
  }
  if (status >= 500 || (err !== undefined && err !== null && status < 400)) {
    return "error";
  }
  if (status === 401) {
    return "info";
  }
  return status >= 400 ? "warn" : "info";
}
