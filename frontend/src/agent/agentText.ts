import type { AgentStatusResponse, ServerSummary } from "@satisfactory-dash/shared";
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

/**
 * The agent's own view of its game connection (#740 follow-up), from the status's optional `gameReachable` and
 * `lastGameReadAt`. Null when there is nothing to show (no agent, or one that doesn't report it, or an older backend).
 * While the agent is offline its last word may be stale, so reachability reads as unknown; the last read still shows.
 */
export interface GameConnectionView {
  /** `ok` and `warn` take the status tokens and an icon; `unknown` is muted. */
  tone: "ok" | "warn" | "unknown";
  label: string;
  /** "last read 8 s ago", "not read since the mod started", or null when not reported. */
  lastRead: string | null;
}

export function gameConnectionView(
  agent: Pick<AgentStatusResponse, "enrolled" | "online" | "gameReachable" | "lastGameReadAt">,
  now: number,
): GameConnectionView | null {
  const noun = SENDER_WORDS.noun;
  if (!agent.enrolled || (agent.gameReachable === undefined && agent.lastGameReadAt === undefined)) return null;
  const lastRead = agent.lastGameReadAt !== undefined ? lastReadText(agent.lastGameReadAt, now) : agent.gameReachable === false ? `not read since ${noun} started` : null;
  if (agent.online === false) return { tone: "unknown", label: `Unknown while ${noun} is offline`, lastRead };
  if (agent.gameReachable === true) return { tone: "ok", label: "Reachable", lastRead };
  if (agent.gameReachable === false) return { tone: "warn", label: "Not reachable", lastRead };
  return { tone: "unknown", label: "Reachability not reported", lastRead };
}

/** "last read 8 s ago"; a time "from the future" counts as now (the backend already drops one far ahead). */
function lastReadText(at: string, now: number): string {
  const read = Date.parse(at);
  if (Number.isNaN(read)) return "last read at an unknown time";
  const seconds = Math.floor(Math.max(0, now - read) / 1000);
  return seconds < 1 ? "last read just now" : `last read ${formatDuration(seconds)} ago`;
}

/**
 * The agent's version line: `agentVersion`, plus the sender's `modVersion` when it says something else (a mod sending for
 * the agent). The dash agent sends the same string twice, so it shows once.
 */
export function agentVersionLine(agentVersion: string | null, modVersion: string | undefined): string {
  if (agentVersion === null) return modVersion === undefined ? "Not reported yet" : versionText(modVersion);
  return modVersion === undefined || modVersion === agentVersion ? versionText(agentVersion) : `${versionText(agentVersion)} · sender ${versionText(modVersion)}`;
}

/**
 * How the backend reaches the server, in words. An unknown kind is shown as it came. An `agent` server is fed by the
 * mod, the only way a server connects (ADR-0066); a `local` row is a leftover until the backend converts it.
 */
export function connectionText(kind: string): string {
  if (kind === "local") return "Directly, from the dashboard's backend";
  if (kind === "agent") return "Through the Satis Manager mod";
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

/** The words Settings uses for what sends a server's data: the mod, for everyone (ADR-0066 retired the Node agent). */
export interface SenderWords {
  /** The Settings section's heading, its crash-boundary label and its search-palette entry. */
  heading: string;
  /** The status row's label ("Mod: Enrolled · Online"). */
  label: string;
  versionLabel: string;
  /** In a sentence: "the mod". */
  noun: string;
  /** The confirmed revoke button. */
  revoke: string;
  /** The confirm group's accessible name. */
  revokeConfirm: string;
  /** What revoking does, said before the button. */
  revokeWarning: string;
}

export const SENDER_WORDS: SenderWords = {
  heading: "Satis Manager mod",
  label: "Mod",
  versionLabel: "Mod version",
  noun: "the mod",
  revoke: "Revoke the mod's access",
  revokeConfirm: "Confirm revoking the mod's access",
  revokeWarning: "The mod's access ends at once. This server then shows no data, and can't be changed, until the mod is enrolled again.",
};

/**
 * The agent's reported version for Settings. A stamped build (`0.1.0+abc1234.20261024`) reads as
 * `0.1.0 (build abc1234, 2026-10-24)`, so a copy built from old source is recognisable; anything else is shown as is.
 */
export function versionText(version: string): string {
  const m = /^(.+)\+([0-9a-f]{4,12})\.(\d{4})(\d{2})(\d{2})$/.exec(version);
  return m ? `${m[1]} (build ${m[2]}, ${m[3]}-${m[4]}-${m[5]})` : version;
}

/** Who may revoke the agent: the server's owner or admin. */
export function canRevoke(role: ServerSummary["role"]): boolean {
  return role === "owner" || role === "admin";
}
