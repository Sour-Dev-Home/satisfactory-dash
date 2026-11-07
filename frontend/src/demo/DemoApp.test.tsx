import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { signOutFromMenu } from "../test/account";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { PREVIEW } from "../landing/preview";
import { renderWithClient } from "../test/render";
import { resetDemoState } from "./handlers";
import { resetTourLoadForTests, TOUR_SEEN, TOUR_STORAGE_KEY } from "./tour/persistence";
import { resetTourStoreForTests } from "./tour/tourStore";

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
  // The guided tour (ADR-0065) would start on the first visit to /app; these tests are about the pages under it.
  window.localStorage.setItem(TOUR_STORAGE_KEY, TOUR_SEEN);
  resetTourStoreForTests();
});

describe("the demo app", () => {
  it("says it's a demo, offers 'Enter demo' instead of a sign-in form, and never uses the network", async () => {
    renderWithClient(<App />);
    expect(screen.getByText(/Demo data: nothing here is live/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Enter demo" }, FIRST_RENDER)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    // The landing's hero (#444): the logo, the sentence, Enter demo as the amber action, the Overview still.
    const hero = screen.getByRole("region", { name: /A live dashboard for a Satisfactory dedicated server/ });
    expect(hero.querySelector('svg[data-station="factory"]')).not.toBeNull();
    expect(within(hero).getByRole("button", { name: "Enter demo" })).toHaveClass("bg-accent");
    expect(screen.getByRole("img", { name: /^The Satis Manager Overview/ })).toHaveAttribute("src", PREVIEW.src);

    fireEvent.click(screen.getByRole("button", { name: "Enter demo" }));
    expect(await screen.findByText("Demo factory", {}, FIRST_RENDER)).toBeInTheDocument();
    const rows = await screen.findByRole("list", { name: "Sections" }, FIRST_RENDER);
    // The Server tile: the save and its play time (ADR-0064; the players are the Players card's).
    expect(await within(rows).findByText(/^Demo World · .+ played$/, {}, FIRST_RENDER)).toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: /^All 10$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Backed up 2$/ })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("link", { name: "Settings" }));
    const toggle = await screen.findByRole("checkbox", { name: "Auto-pause when no players are connected" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(await screen.findByText("Change pending: the server will apply it.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks the guided tour's targets on Power, Factory and Settings (ADR-0065 build PR 2)", async () => {
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Enter demo" }, FIRST_RENDER));
    const nav = await screen.findByRole("navigation", { name: "Main" }, FIRST_RENDER);
    const target = (id: string) => document.querySelector(`[data-tour="${id}"]`);

    fireEvent.click(within(nav).getByRole("link", { name: "Power" }));
    expect(await screen.findByRole("article", { name: "Circuit 0 history" })).toBe(target("power-chart"));
    expect(document.querySelectorAll('[data-tour="power-chart"]')).toHaveLength(1);
    expect(within(target("power-circuits") as HTMLElement).getByRole("article", { name: "Circuit 0" })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("link", { name: "Factory" }));
    expect(await screen.findByRole("region", { name: "Factory" })).toBe(target("factory-machines"));
    expect(await screen.findByRole("region", { name: "Bottlenecks" })).toBe(target("factory-bottlenecks"));

    fireEvent.click(within(nav).getByRole("link", { name: "Settings" }));
    // The first rule (the power outage's) and the agent's status rows: the whole parts are taller than a phone.
    const rules = await screen.findByRole("group", { name: "Rules" });
    const [firstRule] = await within(rules).findAllByRole("article");
    expect(firstRule).toBe(target("settings-alerts"));
    expect(firstRule).toHaveAccessibleName(/Power outage/);
    expect(document.querySelectorAll('[data-tour="settings-alerts"]')).toHaveLength(1);
    const agent = screen.getByRole("region", { name: "Game PC agent" });
    expect(target("settings-connection")?.tagName).toBe("DL");
    expect(agent).toContainElement(target("settings-connection") as HTMLElement);
  });

  it("signs out to 'Enter demo' again", async () => {
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Enter demo" }));
    await signOutFromMenu();
    expect(await screen.findByRole("button", { name: "Enter demo" })).toBeInTheDocument();
  });

  it("starts the guided tour on the first visit to the Overview, on its Health card (ADR-0065)", async () => {
    window.localStorage.removeItem(TOUR_STORAGE_KEY);
    resetTourLoadForTests();
    // jsdom lays nothing out; the tour highlights only an element with a box.
    const box = { x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, toJSON: () => ({}) } as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(box);
    try {
      renderWithClient(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Enter demo" }, FIRST_RENDER));
      const tour = await screen.findByRole("dialog", { name: "Welcome to the demo." }, FIRST_RENDER);
      expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe(TOUR_SEEN);
      // The welcome is centred at once, so it can show a frame before the Overview's Health card has rendered.
      await waitFor(() => expect(document.querySelector('[data-tour="overview-health"]')).toHaveAccessibleName("Health"), FIRST_RENDER);
      expect(document.querySelector('[data-tour="overview-alerts"]')).not.toBeNull();
      fireEvent.click(within(tour).getByRole("button", { name: "Skip tour" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Take the tour" }));
    } finally {
      vi.restoreAllMocks();
    }
  });
});
