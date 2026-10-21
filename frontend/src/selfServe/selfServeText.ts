import { CreateAgentServerRequestSchema, type ServerSummary } from "@satisfactory-dash/shared";
import { ApiError } from "../api/errors";

/** ADR-0046: the owner of a server created through self-serve may rename and delete it. Nobody else is offered the controls. */
export function isSelfServeOwner(server: Pick<ServerSummary, "role" | "createdVia">): boolean {
  return server.role === "owner" && server.createdVia === "self_serve";
}

/** A self-serve server that has never enrolled an agent (the list says `enrolled: false`). It is removed after 24 hours (ADR-0046 C4). */
export function isPending(server: Pick<ServerSummary, "enrolled">, agentEnrolled: boolean | undefined): boolean {
  return server.enrolled === false && agentEnrolled !== true;
}

/** The pending notice, in two parts so the first can be the link to the agent panel: what to do, then when it is removed. */
export const PENDING_ACTION = "Create an enrolment code above";
export const PENDING_ACTION_REST = " to connect it. A server that has not connected within 24 hours of adding it is removed automatically.";

/** What the owner's first server list says about adding another: C3 refuses while one waits for its first connection. */
export function pendingServerName(
  servers: readonly Pick<ServerSummary, "id" | "role" | "createdVia" | "enrolled" | "displayName">[],
  enrolledNow: { serverId: string; enrolled: boolean | undefined },
): string | undefined {
  return servers.find(
    (s) =>
      s.role === "owner" &&
      s.createdVia === "self_serve" &&
      s.enrolled === false &&
      !(s.id === enrolledNow.serverId && enrolledNow.enrolled === true),
  )?.displayName;
}

export const DELETE_LEAD = "Deleting removes this server from the dashboard for good. What goes:";
export const DELETE_GOES = ["Its history and alerts", "Its push settings and members", "Its agent or mod connection, which stops working"];
export const DELETE_CLOSING = "This can't be undone. Your game server and save are not touched.";

export const CODE_LIFETIME = "10 minutes";

/** The name check the backend runs, from the shared schema; the empty case gets plain words instead of zod's. */
export function nameProblem(raw: string): string | undefined {
  if (raw.trim() === "") return "Enter a name for your server.";
  const parsed = CreateAgentServerRequestSchema.safeParse({ displayName: raw });
  return parsed.success ? undefined : (parsed.error.issues[0]?.message ?? "That name isn't allowed.");
}

/** "in about 5 hours", "in about 12 minutes", "in a minute": the wait a 429's Retry-After asks for, or "later" without one. */
export function retryText(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) return "later";
  if (seconds < 90) return "in a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `in about ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return `in about ${hours} hours`;
}

/** A cap or rate limit: an expected refusal, shown as a note rather than as a failure. */
export function isLimitRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "server_limit_reached" || error.status === 429 || error.code === "rate_limited");
}

/**
 * The text for a refused "Add your server", or undefined to fall back to ErrorNotice (network, drift...).
 * 409 `server_limit_reached` (C1 to C3) carries its own clear message from the backend (it names the
 * pending server, or says the service is full); 429 (C5 and the write limiter) gets the wait; 403 means
 * self-serve is off.
 */
export function addServerErrorText(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === "server_limit_reached") return error.message;
  if (error.status === 429 || error.code === "rate_limited") {
    return `You can't add another server right now. Try again ${retryText(error.retryAfterSeconds)}.`;
  }
  if (error.code === "forbidden") return "Adding your own server isn't available right now.";
  return undefined;
}

/** The text for a failed rename or delete, or undefined for ErrorNotice. */
export function ownerActionErrorText(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === "forbidden") return "Only the owner of a server you added can do that.";
  if (error.code === "server_not_found") return "This server has already been removed.";
  return undefined;
}
