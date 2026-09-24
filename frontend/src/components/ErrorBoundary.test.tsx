import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error("boom: secret internal detail");
  return <p>recovered content</p>;
}

beforeEach(() => {
  shouldThrow = true;
  // React logs caught render errors; keep test output quiet but observable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("shows a labelled notice instead of the crashed part, without error details", () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert", { name: "Power error" });
    expect(alert).toHaveTextContent("Power hit an error and couldn't be shown.");
    expect(alert).not.toHaveTextContent(/boom|secret/);
  });

  it("logs the error to the console with the section label", () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(
      "[Power] failed to render",
      expect.objectContaining({ message: "boom: secret internal detail" }),
      expect.anything(),
    );
  });

  it("keeps sibling sections rendering", () => {
    render(
      <>
        <ErrorBoundary label="Power">
          <Flaky />
        </ErrorBoundary>
        <ErrorBoundary label="Factory">
          <p>factory content</p>
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByText("factory content")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("re-renders the part on Try again", () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("recovered content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the notice again if the part still fails", () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("alert", { name: "Power error" })).toBeInTheDocument();
  });

  it("moves focus into the recovered part on Try again", () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(screen.getByText("recovered content"));
  });

  it("moves focus to the notice if the part fails again", () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("alert", { name: "Power error" })).toHaveFocus();
  });

  it("does not take focus when nobody pressed Try again", () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(document.body).toHaveFocus();
  });

  it("shows extra actions in the notice", () => {
    render(
      <ErrorBoundary label="Power" actions={<button type="button">Log out</button>}>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toContainElement(screen.getByRole("button", { name: "Log out" }));
  });
});
