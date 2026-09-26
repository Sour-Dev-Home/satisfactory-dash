import type { ServerSummary } from "@satisfactory-dash/shared";
import { formatDuration } from "../format";

/**
 * "Last seen 8 s ago" from the agent's `lastSeenAt` (ADR-0031 PR 7). Text only: whether the agent is
 * offline is the backend's call, never this clock's. A time "from the future" counts as now.
 */
export function lastSeenText(lastSeenAt: string | null, now: number): string {
  if (lastSeenAt === null) return "Hasn't reported yet";
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return "Last seen at an unknown time";
  const seconds = Math.floor(Math.max(0, now - seen) / 1000);
  return seconds < 1 ? "Last seen just now" : `Last seen ${formatDuration(seconds)} ago`;
}

/** How the backend reaches the server, in words. An unknown kind is shown as it came. */
export function connectionText(kind: string): string {
  if (kind === "local") return "Directly, from the dashboard's backend";
  if (kind === "agent") return "Through the game PC's agent";
  return kind;
}

/**
 * Who may create an enrolment code (the backend decides; this only hides controls that would 403).
 * Enrolling turns a `local` server into an `agent` one and deletes its stored tokens, so for a local
 * server only the operator may; otherwise the server's owner or admin.
 */
export function canCreateCode(kind: string, role: ServerSummary["role"], isOperator: boolean): boolean {
  if (kind === "local") return isOperator;
  return role === "owner" || role === "admin";
}

/**
 * The backend address for the agent's `--url`: the frontend's configured API origin (VITE_API_URL) when
 * it has one, so the command can be pasted as is. In development (Vite proxies only /api, not the
 * agent's /agent/v1) and in the demo it's empty, so the placeholder stays.
 */
export function agentBackendUrl(configured: string | undefined): string {
  const origin = (configured ?? "").trim().replace(/\/+$/, "");
  return origin.startsWith("https://") ? origin : "https://<your backend>";
}

/** Who may revoke the agent: the server's owner or admin. */
export function canRevoke(role: ServerSummary["role"]): boolean {
  return role === "owner" || role === "admin";
}
