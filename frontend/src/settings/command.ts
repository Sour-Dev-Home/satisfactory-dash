import type { Command } from "@satisfactory-dash/shared";
import { FINAL_COMMAND_STATUSES } from "../api/queries";

/**
 * Where a relayed change stands (ADR-0031 PR 4). For a server reached through the edge agent, a
 * change is a command the game PC picks up; the page follows it to one of these. The contract's
 * status is an open string (deploy skew), so anything this build doesn't know counts as still on
 * its way; the view gives up at the command's expiry either way.
 */
export type CommandPhase = "waiting" | "succeeded" | "failed" | "expired";

export function commandPhase(status: string): CommandPhase {
  return FINAL_COMMAND_STATUSES.includes(status) ? (status as CommandPhase) : "waiting";
}

/**
 * How long past `expiresAt` the page waits for the backend's own "expired" before giving up: the
 * two clocks differ a little, and the backend is the one that decides.
 */
export const EXPIRY_GRACE_MS = 5_000;

/** Milliseconds until the page stops waiting for this command (never negative). */
export function msUntilGiveUp(command: Pick<Command, "expiresAt">, now: number): number {
  return Math.max(0, Date.parse(command.expiresAt) + EXPIRY_GRACE_MS - now);
}

export const EXPIRED_TEXT = "The game PC didn't answer in time; the setting didn't change.";

const FAILURE_TEXT: Record<string, string> = {
  unsupported: "The agent on the game PC can't change this setting. Update the agent and try again.",
  upstream_unreachable: "The game PC couldn't reach the game server, so the setting didn't change.",
  upstream_auth_rejected: "The game server refused the agent's admin token, so the setting didn't change.",
  upstream_error: "The game server reported an error, so the setting didn't change.",
};

/** Why a relayed change failed, by the agent's result code; an unknown or missing code gets a general line. */
export function failureText(resultCode: string | null): string {
  return (resultCode !== null && FAILURE_TEXT[resultCode]) || "The change failed on the game PC; the setting didn't change.";
}
