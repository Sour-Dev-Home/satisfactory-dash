import type { ReactNode } from "react";
import { ApiError, ContractDriftError, classifyError } from "../api/errors";

/**
 * One message per error kind, plus the request ID when there is one, so a report can be
 * matched to the backend's logs. Used by every screen, so the wording stays consistent.
 */
export function ErrorNotice({ error, action }: { error: unknown; action?: ReactNode }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert">
      <p>{describe(error)}</p>
      {requestId && <p>Request ID: {requestId}</p>}
      {action}
    </div>
  );
}

function describe(error: unknown): string {
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
    default:
      // The envelope's message is safe to show a user (ADR-0003); unknown codes land here.
      return error instanceof ApiError ? error.message : "Something went wrong.";
  }
}
