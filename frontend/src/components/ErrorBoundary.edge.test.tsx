import { StrictMode, useEffect, useLayoutEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// Independent (test-hunter) pass on the focus-after-Try-again change.

let mode: "ok" | "render" | "layout" | "effect" = "render";
function Flaky() {
  useLayoutEffect(() => {
    if (mode === "layout") throw new Error("layout boom");
  });
  useEffect(() => {
    if (mode === "effect") throw new Error("effect boom");
  });
  if (mode === "render") throw new Error("render boom");
  return <p>recovered content</p>;
}

beforeEach(() => {
  mode = "render";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function clickTryAgain() {
  const button = screen.getByRole("button", { name: "Try again" });
  button.focus();
  fireEvent.click(button);
}

describe("ErrorBoundary focus after Try again (edge cases)", () => {
  it("focuses the notice when the part fails again in a layout effect, not <body>", () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    mode = "layout";
    clickTryAgain();
    const alert = screen.getByRole("alert", { name: "Power error" });
    expect(alert).toHaveFocus();
  });

  it("focuses the notice when the part fails again in a passive effect, not <body>", async () => {
    render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    mode = "effect";
    await act(async () => clickTryAgain());
    const alert = screen.getByRole("alert", { name: "Power error" });
    expect(alert).toHaveFocus();
  });

  it("focuses the notice when the recovered part fails again a moment later (e.g. data arrives)", async () => {
    let fail: () => void = () => {};
    function LaterFlaky() {
      const [broken, setBroken] = useState(false);
      useEffect(() => {
        fail = () => setBroken(true);
      });
      if (broken || mode === "render") throw new Error("data-dependent boom");
      return <p>recovered content</p>;
    }
    render(
      <ErrorBoundary label="Power">
        <LaterFlaky />
      </ErrorBoundary>,
    );
    mode = "ok";
    clickTryAgain();
    expect(document.activeElement).toContainElement(screen.getByText("recovered content"));
    await act(async () => fail());
    // Focus was inside the part when it crashed; it must not fall back to <body>.
    expect(screen.getByRole("alert", { name: "Power error" })).toHaveFocus();
  });

  it("recovers and focuses the part when React's own render retry succeeds", () => {
    let throwsLeft = 0;
    function OnceFlaky() {
      if (throwsLeft > 0) {
        throwsLeft--;
        throw new Error("transient");
      }
      return <p>recovered content</p>;
    }
    const { rerender } = render(
      <ErrorBoundary label="Power">
        <Flaky />
      </ErrorBoundary>,
    );
    throwsLeft = 1;
    rerender(
      <ErrorBoundary label="Power">
        <OnceFlaky />
      </ErrorBoundary>,
    );
    // Still showing the notice (the boundary is in error state); now retry once-flaky child.
    // React reports the recovered throw through reportError; that's expected here.
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", swallow);
    try {
      clickTryAgain();
    } finally {
      window.removeEventListener("error", swallow);
    }
    expect(screen.getByText("recovered content")).toBeInTheDocument();
    expect(document.activeElement).toContainElement(screen.getByText("recovered content"));
  });

  it("works under StrictMode: focus lands on the recovered part", () => {
    render(
      <StrictMode>
        <ErrorBoundary label="Power">
          <Flaky />
        </ErrorBoundary>
      </StrictMode>,
    );
    mode = "ok";
    clickTryAgain();
    expect(document.activeElement).toContainElement(screen.getByText("recovered content"));
  });

  it("does not steal focus on a later parent re-render or a later unrelated crash", () => {
    let bump: () => void = () => {};
    let crashLater = false;
    function Later() {
      if (crashLater) throw new Error("later");
      return <p>recovered content</p>;
    }
    function Parent() {
      const [n, setN] = useState(0);
      useEffect(() => {
        bump = () => setN((x) => x + 1);
      });
      return (
        <>
          <input aria-label="elsewhere" />
          <span>{n}</span>
          <ErrorBoundary label="Power">{mode === "render" ? <Flaky /> : <Later />}</ErrorBoundary>
        </>
      );
    }
    render(<Parent />);
    mode = "ok";
    clickTryAgain();
    const elsewhere = screen.getByRole("textbox", { name: "elsewhere" });
    elsewhere.focus();
    act(() => bump());
    expect(elsewhere).toHaveFocus();
    crashLater = true;
    act(() => bump());
    expect(screen.getByRole("alert", { name: "Power error" })).toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });

  it("nested: outer Try again with the inner part still broken keeps focus inside the page", () => {
    let outerBroken = true;
    function OuterFlaky() {
      if (outerBroken) throw new Error("outer");
      return null;
    }
    render(
      <ErrorBoundary label="The dashboard">
        <OuterFlaky />
        <ErrorBoundary label="Power">
          <Flaky />
        </ErrorBoundary>
      </ErrorBoundary>,
    );
    outerBroken = false;
    clickTryAgain();
    expect(screen.getByRole("alert", { name: "Power error" })).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(screen.getByRole("alert", { name: "Power error" }));
  });

  it("nested: inner Try again focuses only the inner part, outer never takes focus", () => {
    render(
      <ErrorBoundary label="The dashboard">
        <p>other section</p>
        <ErrorBoundary label="Power">
          <Flaky />
        </ErrorBoundary>
      </ErrorBoundary>,
    );
    mode = "ok";
    clickTryAgain();
    const focused = document.activeElement as HTMLElement;
    expect(focused).toContainElement(screen.getByText("recovered content"));
    expect(focused).not.toContainElement(screen.getByText("other section"));
  });
});
