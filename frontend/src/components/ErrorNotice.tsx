import type { ReactNode } from "react";
import { ApiError, ContractDriftError, classifyError } from "../api/errors";

/**
 * One message per error kind, plus the request ID when there is one, so a report can be
 * matched to the backend's logs. Used by every screen, so the wording stays consistent.
 * "Game server unreachable" is a state, not a fault to report, and its ID changes on every
 * poll (owner, 2026-10-21): it stays readable as `data-request-id` in the dev tools only.
 */
export function ErrorNotice({ error, action }: { error: unknown; action?: ReactNode }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  const showRequestId = requestId !== undefined && classifyError(error) !== "upstream_unreachable";
  return (
    <div role="alert" data-request-id={requestId}>
      <p>{describeError(error)}</p>
      {showRequestId && <p>Request ID: {requestId}</p>}
      {action}
    </div>
  );
}

export function describeError(error: unknown): string {
  switch (classifyError(error)) {
    case "backend_unreachable":
      return "Couldn't reach the dashboard backend.";
    case "contract_drift":
      return (
        `The dashboard got a response it doesn't understand from ${(error as ContractDriftError).path}. ` +
        "The dashboard and backend versions may not match."
      );
    case "upstream_unreachable":
      return "Game server unreachable.";
    case "upstream_auth_rejected":
      // The single operator is also the admin, so say what to fix.
      return "The dashboard's credentials for the game server were rejected. Check the backend's server token.";
    case "upstream":
      return "The game server returned an error.";
    case "server_not_found":
      return "This game server is no longer configured.";
    case "client_bug":
      return "Something went wrong in the dashboard.";
    case "reauth_required":
      // ADR-0047: a 403 that is not "signed out". The account screen offers the sign-in itself.
      return "Sign in again first: this needs a sign-in from the last 10 minutes.";
    case "would_orphan":
      // ADR-0047: the backend's message says which server and what to do instead (safe to show, ADR-0003).
      return error instanceof ApiError ? error.message : "That would leave a server without an owner.";
    default:
      // The envelope's message is safe to show a user (ADR-0003); unknown codes land here.
      return error instanceof ApiError ? error.message : "Something went wrong.";
  }
}
