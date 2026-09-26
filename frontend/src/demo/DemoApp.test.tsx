import { fireEvent, screen, within } from "@testing-library/react";
import { signOutFromMenu } from "../test/account";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { renderWithClient } from "../test/render";
import { resetDemoState } from "./handlers";

// The whole app as the demo build runs it (ADR-0026): what vite.config.ts does at build time
// (IS_DEMO true, the demo transport in place of the network one), done here with mocks.
vi.mock("./mode", () => ({ IS_DEMO: true }));
vi.mock("../api/transport", async () => await import("./transport"));

// The whole app's first render in jsdom can pass findBy*'s 1 s default on a busy CI runner
// (1.4 s on #173's run), so the waits on it get more room.
const FIRST_RENDER = { timeout: 5000 };

const fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));

beforeEach(() => {
  resetDemoState();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("the demo app", () => {
  it("says it's a demo, offers 'Enter demo' instead of a sign-in form, and never uses the network", async () => {
    renderWithClient(<App />);
    expect(screen.getByText(/Demo data: nothing here is live/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Enter demo" }, FIRST_RENDER)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enter demo" }));
    expect(await screen.findByText("Demo factory", {}, FIRST_RENDER)).toBeInTheDocument();
    const rows = await screen.findByRole("list", { name: "Sections" }, FIRST_RENDER);
    // Real clock here: the demo's players come and go, so any count of the 4 slots.
    expect(await within(rows).findByText(/Demo World · [0-4] \/ 4 players/, {}, FIRST_RENDER)).toBeInTheDocument();
    expect(screen.getByText(/Demo data: nothing here is live/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows every page with demo data", async () => {
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Enter demo" }));
    const nav = await screen.findByRole("navigation", { name: "Main" });

    fireEvent.click(within(nav).getByRole("link", { name: "Power" }));
    expect(await screen.findByRole("article", { name: "Circuit 0" })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: "Circuit 1 history" })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("link", { name: "Factory" }));
    expect(await screen.findByText("9 machines · 1 backed up · 0 paused · 0 without a recipe")).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("link", { name: "Settings" }));
    const toggle = await screen.findByRole("checkbox", { name: "Auto-pause when no players are connected" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(await screen.findByText("Change pending: the server will apply it.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("signs out to 'Enter demo' again", async () => {
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Enter demo" }));
    await signOutFromMenu();
    expect(await screen.findByRole("button", { name: "Enter demo" })).toBeInTheDocument();
  });
});
