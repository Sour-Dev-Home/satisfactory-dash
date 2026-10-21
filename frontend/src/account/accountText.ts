import type { ServerSummary } from "@satisfactory-dash/shared";
import { ApiError } from "../api/errors";

// ADR-0047 (#311 task 3): the words and rules of "Delete my account" and "Leave this server". Removing a server is
// always "removed from Satisfactory Dash", never "deleted": the player's game and its saves are never touched.

/** What deleting the account removes, in the order a person thinks of it. */
export const DELETE_GOES = [
  "Your account and your sign-in",
  "Every session, on every device",
  "Your membership of every server",
  "Your alert notification sign-ups",
] as const;

export const DELETE_SERVERS_GO = "Servers you added yourself are removed from Satisfactory Dash.";
export const GAME_UNTOUCHED = "Your game and its saves are never touched: nothing on your game PC changes.";
export const DELETE_KEPT =
  "Kept: the audit records of what was done, for their normal year. They name only a random id, which nothing links back to you once your account is gone.";
export const OPERATOR_CANNOT_DELETE = "The operator's account can't be deleted here.";

export const REAUTH_LEAD = "To delete your account, sign in again first: it needs a sign-in from the last 10 minutes.";
export const REAUTH_THEN = "Then come back to Settings and delete your account.";
export const REAUTH_PASSWORD = "Sign out, sign in again, then come back to Settings and delete your account.";

export const OPERATOR_SERVERS_LEAD = "You own servers the operator set up, so your account can't be deleted yet:";
export const OPERATOR_SERVERS_THEN = "They need a new owner first. Contact the operator.";

export const OWNER_CANNOT_LEAVE = "You own this server, so you can't leave it.";
export const OWNER_REMOVE_INSTEAD = "To stop using it, remove it from Satisfactory Dash under Your server.";
export const LEAVE_EFFECT =
  "You'll stop seeing it here and stop getting its alert notifications. The server and its game are not changed. To come back, you'll need a new invitation.";

/** The servers deleting this account removes from Satisfactory Dash: the self-serve ones it owns. */
export function serversRemovedWithAccount(servers: readonly ServerSummary[]): string[] {
  return servers.filter((s) => s.role === "owner" && s.createdVia === "self_serve").map((s) => s.displayName);
}

/** The role in words; an unknown role (a newer backend) is just "member". */
export function roleText(role: string): string {
  return role === "owner" || role === "admin" || role === "viewer" ? role : "member";
}

/**
 * Whether the member may leave this server: anyone with a role but the owner (the backend refuses the owner, 409
 * last_owner). No role at all means an older backend or the no-database path, where there is no membership to leave.
 */
export function canLeave(server: ServerSummary): boolean {
  return server.role !== undefined && server.role !== "owner";
}

/** How a deletion refusal is shown: the account screen words each one, anything else goes to ErrorNotice. */
export type DeleteRefusal =
  | { kind: "reauth" }
  | { kind: "operator_servers"; servers: string[] }
  | { kind: "operator_account" }
  | { kind: "other" };

export function deleteRefusal(error: unknown): DeleteRefusal {
  if (!(error instanceof ApiError)) return { kind: "other" };
  if (error.code === "reauth_required") return { kind: "reauth" };
  if (error.code === "would_orphan" && error.reason === "operator_servers") {
    return { kind: "operator_servers", servers: (error.servers ?? []).map((s) => s.displayName) };
  }
  if (error.code === "forbidden" && error.reason === "operator_account") return { kind: "operator_account" };
  return { kind: "other" };
}

/** Whether a leave was refused because the caller owns the server. */
export const isLastOwner = (error: unknown): boolean =>
  error instanceof ApiError && error.code === "would_orphan" && error.reason === "last_owner";
