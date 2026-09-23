import type { ReactNode } from "react";
import { ApiError, ContractDriftError, classifyError } from "../api/errors";

/**
 * A generic error message with the request ID when there is one, so a report can be
 * matched to the backend's logs. PR 4c builds the per-kind global states on top of this.
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
      return `The dashboard got a response it doesn't understand (${(error as ContractDriftError).path}).`;
    case "client_bug":
      return "Something went wrong in the dashboard.";
    default:
      // The envelope's message is safe to show a user (ADR-0003).
      return error instanceof ApiError ? error.message : "Something went wrong.";
  }
}
