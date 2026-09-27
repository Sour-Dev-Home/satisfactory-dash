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

  it("shows extra actions in the notice", () => {
    render(
      <ErrorBoundary label="Power" actions={<button type="button">Log out</button>}>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toContainElement(screen.getByRole("button", { name: "Log out" }));
  });

  describe("a chunk a deploy removed (#325)", () => {
    function Stale(): never {
      throw new TypeError("Failed to fetch dynamically imported module: https://example.test/assets/PowerChart-abc.js");
    }
    const RELOAD_KEY = "satis-manager.stale-chunk-reload-at";
    beforeEach(() => window.sessionStorage.clear());

    it("asks for a reload instead of Try again, when a reload just happened", () => {
      window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      render(
        <ErrorBoundary label="Power history">
          <Stale />
        </ErrorBoundary>,
      );
      const alert = screen.getByRole("alert", { name: "Power history error" });
      expect(alert).toHaveTextContent("A new version of the dashboard is available. Reload the page to see it.");
      expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("reloads by itself once when no reload happened lately", () => {
      render(
        <ErrorBoundary label="Power history">
          <Stale />
        </ErrorBoundary>,
      );
      // jsdom can't navigate; the guard's record shows the reload was attempted.
      expect(Number(window.sessionStorage.getItem(RELOAD_KEY))).toBeGreaterThan(0);
    });

    it("keeps Try again for any other error", () => {
      render(
        <ErrorBoundary label="Power">
          <Flaky />
        </ErrorBoundary>,
      );
      expect(window.sessionStorage.getItem(RELOAD_KEY)).toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    });

    it("reloads the page when Reload is clicked, unguarded (an explicit user request)", () => {
      window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      // jsdom's window.location.reload isn't configurable enough for vi.spyOn; replace the
      // whole location object instead, then restore it so other tests get the real jsdom one.
      const originalLocation = window.location;
      const reload = vi.fn();
      Object.defineProperty(window, "location", { value: { ...originalLocation, reload }, writable: true });
      try {
        render(
          <ErrorBoundary label="Power history">
            <Stale />
          </ErrorBoundary>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Reload" }));
        expect(reload).toHaveBeenCalledTimes(1);
      } finally {
        Object.defineProperty(window, "location", { value: originalLocation, writable: true });
      }
    });
  });
});
