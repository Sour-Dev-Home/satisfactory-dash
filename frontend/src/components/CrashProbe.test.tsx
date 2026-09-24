import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// The probe keeps a module-level "already crashed" set, so each test loads a fresh copy.
async function loadProbe() {
  vi.resetModules();
  return (await import("./CrashProbe")).CrashProbe;
}

function setSearch(search: string) {
  window.history.replaceState(null, "", `/${search}`);
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setSearch("");
});

describe("CrashProbe", () => {
  it("does nothing outside mock mode, even when asked to crash", async () => {
    vi.stubEnv("MODE", "development");
    setSearch("?crash=power");
    const CrashProbe = await loadProbe();
    render(
      <ErrorBoundary label="Power">
        <CrashProbe section="power" />
        <p>power content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("power content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("only crashes the named section", async () => {
    vi.stubEnv("MODE", "mock");
    setSearch("?crash=factory");
    const CrashProbe = await loadProbe();
    render(
      <ErrorBoundary label="Power">
        <CrashProbe section="power" />
        <p>power content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("power content")).toBeInTheDocument();
  });

  // main.tsx renders under StrictMode, and dev mock mode is where the probe is meant to be
  // used, so the fallback must actually appear there (React may re-render after a throw).
  it.each([
    ["without StrictMode", false],
    ["under StrictMode, as main.tsx renders", true],
  ])("shows the fallback in mock mode %s, and Try again recovers", async (_name, strict) => {
    vi.stubEnv("MODE", "mock");
    setSearch("?crash=power");
    const CrashProbe = await loadProbe();
    const tree = (
      <ErrorBoundary label="Power">
        <CrashProbe section="power" />
        <p>power content</p>
      </ErrorBoundary>
    );
    render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    expect(screen.getByRole("alert", { name: "Power error" })).toBeInTheDocument();
    expect(screen.queryByText("power content")).not.toBeInTheDocument();

    // A real click always comes in a later task than the render.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("power content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
