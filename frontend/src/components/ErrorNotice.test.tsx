import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiErrorResponse } from "@satisfactory-dash/shared";
import {
  errorNotEditable,
  errorRateLimited,
  errorServerNotFound,
  errorWithDetail,
} from "@satisfactory-dash/shared/fixtures";
import { ApiError, BackendUnreachableError, ContractDriftError, RequestValidationError } from "../api/errors";
import { ErrorNotice } from "./ErrorNotice";

// ErrorNotice had no test of its own; these pin the rules the contract sets for it (ADR-0003).

describe("ErrorNotice", () => {
  it("never shows the internal detail, even when the backend sends it", () => {
    render(<ErrorNotice error={new ApiError(502, errorWithDetail.error)} />);
    const alert = screen.getByRole("alert");
    expect(errorWithDetail.error.detail).toBeTruthy();
    expect(alert).not.toHaveTextContent(errorWithDetail.error.detail);
    expect(alert).toHaveTextContent(`Request ID: ${errorWithDetail.error.requestId}`);
  });

  it("says a lost game server is no longer configured", () => {
    render(<ErrorNotice error={new ApiError(404, errorServerNotFound.error)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This game server is no longer configured.");
  });

  it.each([
    ["not_editable", errorNotEditable, 409],
    ["rate_limited", errorRateLimited, 429],
  ] as const)("shows the backend's safe message for %s", (_, body, status) => {
    render(<ErrorNotice error={new ApiError(status, body.error)} />);
    expect(screen.getByRole("alert")).toHaveTextContent(body.error.message);
  });

  it("handles an unknown code generically with the envelope's message", () => {
    const body = {
      error: { code: "brand_new_code", message: "Something new happened", requestId: "req-new" },
    } satisfies ApiErrorResponse;
    render(<ErrorNotice error={new ApiError(418, body.error)} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something new happened");
    expect(alert).toHaveTextContent("Request ID: req-new");
  });

  it("shows no request ID line for errors that never reached the backend", () => {
    render(<ErrorNotice error={new BackendUnreachableError("/api/servers")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the dashboard backend.");
    expect(screen.queryByText(/Request ID/)).not.toBeInTheDocument();
  });

  it("does not list contract-drift issues or request-body issues to the user", () => {
    const { unmount } = render(
      <ErrorNotice error={new ContractDriftError("/api/servers", 200, ["servers.0.id: Invalid string"])} />,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Invalid string");
    unmount();
    render(<ErrorNotice error={new RequestValidationError("/api/auth/login", ["password: Too big"])} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong in the dashboard.");
  });

  it("falls back to a generic message for a thrown non-Error", () => {
    render(<ErrorNotice error="boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
  });
});
