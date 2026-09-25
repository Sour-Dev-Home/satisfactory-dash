import { ConfigError } from "../errors.js";

/**
 * Missed-backup alerting (ADR-0025 decision 7 follow-up): after a backup that was really uploaded, the
 * script GETs a heartbeat URL (a Better Stack heartbeat: daily, with a grace period, alerting the ops
 * address). No ping in time means "the backup did not happen", whatever the reason (task not running,
 * PC off, a failure). Sending it is best effort: a failed ping is logged and NEVER fails the backup.
 *
 * The URL is a secret (whoever has it can mark the heartbeat healthy): it lives only in backend/.env,
 * is never logged, and never appears in an error message or a result.
 */

export type Fetch = (url: string, init: { method: string; signal: AbortSignal; redirect: "error" }) => Promise<{ ok: boolean; status: number }>;

export const HEARTBEAT_TIMEOUT_MS = 10_000;

/** Optional. Unset or blank = no heartbeat. Must be an https URL without embedded credentials. */
export function loadHeartbeatUrl(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.BACKUP_HEARTBEAT_URL?.trim();
  if (!raw) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("BACKUP_HEARTBEAT_URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new ConfigError("BACKUP_HEARTBEAT_URL must be an https URL.");
  }
  if (url.username || url.password) {
    throw new ConfigError("BACKUP_HEARTBEAT_URL must not contain a user name or password.");
  }
  return url.toString();
}

/**
 * The backup script's last step: ping only when a backup was really uploaded (a local-only trial run,
 * or no URL configured, sends nothing). Returns whether a ping was accepted, or undefined when none
 * was attempted.
 */
export async function pingAfterUpload(
  uploaded: boolean,
  url: string | undefined,
  deps: { fetchImpl?: Fetch; log: (line: string) => void; timeoutMs?: number },
): Promise<boolean | undefined> {
  if (!uploaded || url === undefined) {
    return undefined;
  }
  return pingHeartbeat(url, deps);
}

/**
 * GETs the heartbeat URL with a 10-second timeout. Returns whether it was accepted (2xx). Never
 * throws and never puts the URL, a status body or an error message into the log: only a fixed
 * description of what went wrong.
 */
export async function pingHeartbeat(
  url: string,
  deps: { fetchImpl?: Fetch; log: (line: string) => void; timeoutMs?: number },
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as Fetch);
  try {
    // redirect: "error", so the secret URL is never followed (or re-sent) somewhere else.
    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(deps.timeoutMs ?? HEARTBEAT_TIMEOUT_MS),
      redirect: "error",
    });
    if (response.ok) {
      deps.log("heartbeat sent");
      return true;
    }
    deps.log(`heartbeat not accepted (HTTP ${response.status}); the backup itself succeeded`);
    return false;
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    deps.log(`heartbeat failed (${timedOut ? "timed out" : "network error"}); the backup itself succeeded`);
    return false;
  }
}
