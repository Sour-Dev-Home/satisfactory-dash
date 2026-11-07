import { useState, type ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ServerSummary } from "@satisfactory-dash/shared";
import { ServerContext } from "../../servers/ServerContext";
import { DemoBanner } from "../DemoBanner";
import { resetTourLoadForTests, TOUR_STORAGE_KEY } from "./persistence";
import { TOUR_SETTLE_MS } from "./waitForTarget";
import { TOUR_STEPS, type TourStep } from "./steps";
import TourHost from "./TourHost";
import { resetTourStoreForTests } from "./tourStore";

// The targets carry data-tour by hand: in tests IS_DEMO is false, so tour() adds nothing (as in production).
vi.mock("../mode", () => ({ IS_DEMO: true }));

/**
 * The host as the engine's tests see it: no settling wait (a target counts as found once ready, the settling has its own
 * tests below) and no warming (no real chunks imported into jsdom).
 */
function Host(props: ComponentProps<typeof TourHost>) {
  return <TourHost settleMs={0} warm={() => {}} {...props} />;
}

const rect = (x: number, y: number, width: number, height: number) => () =>
  ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;

function Overview() {
  return (
    <div data-page-reveal="revealed">
      <section
        data-tour="overview-health"
        ref={(el) => {
          if (el) el.getBoundingClientRect = rect(20, 200, 400, 300);
        }}
      >
        Health
      </section>
      <button
        type="button"
        data-tour="overview-alerts"
        ref={(el) => {
          if (el) el.getBoundingClientRect = rect(1000, 20, 44, 44);
        }}
      >
        Alerts
      </button>
      <Link to="/app/power">To Power</Link>
    </div>
  );
}

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

/** A panel only a click opens (as the planner's group panel): `onOpen` is told of each click on its opener. */
function Openable({ onOpen }: { onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-page-reveal="revealed">
      <button
        type="button"
        data-tour="opener"
        onClick={() => {
          onOpen();
          setOpen(true);
        }}
        ref={(el) => {
          if (el) el.getBoundingClientRect = rect(20, 20, 100, 44);
        }}
      >
        Open
      </button>
      {open && (
        <aside
          data-tour="panel"
          ref={(el) => {
            if (el) el.getBoundingClientRect = rect(600, 100, 300, 400);
          }}
        >
          Panel
        </aside>
      )}
    </div>
  );
}

function renderApp(path = "/app", steps: readonly TourStep[] = TOUR_STEPS) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DemoBanner />
      <Routes>
        <Route path="/app" element={<Overview />} />
        <Route path="/app/power" element={<p>Power page</p>} />
      </Routes>
      <Where />
      <Host steps={steps} />
    </MemoryRouter>,
  );
}

const dialog = () => screen.getByRole("dialog");

beforeEach(() => {
  resetTourLoadForTests();
  resetTourStoreForTests();
});
afterEach(() => vi.useRealTimers());

describe("the demo's tour", () => {
  it("starts by itself on the first visit to /app, marking it seen at the start", () => {
    renderApp();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("seen");
    const d = dialog();
    expect(d).toHaveAccessibleName(TOUR_STEPS[0].title);
    expect(d).toHaveAccessibleDescription(TOUR_STEPS[0].body);
    expect(d).not.toHaveAttribute("aria-modal");
    // The step line names the tab the step's page is on.
    expect(within(d).getByText(`Step 1 of ${TOUR_STEPS.length} · Overview`)).toBeInTheDocument();
  });

  it("does not start by itself on a deep link, or once seen", () => {
    renderApp("/app/power");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not start by itself when this browser has seen it", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    renderApp();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus to each step's heading, and says only the step's place in a polite live region (the heading says its title)", () => {
    renderApp();
    expect(document.activeElement).toBe(within(dialog()).getByRole("heading", { name: TOUR_STEPS[0].title }));
    expect(screen.getByRole("status")).toHaveTextContent(new RegExp(`^Step 1 of ${TOUR_STEPS.length} · Overview$`));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveAccessibleName(TOUR_STEPS[1].title);
    expect(document.activeElement).toBe(within(dialog()).getByRole("heading", { name: TOUR_STEPS[1].title }));
    expect(screen.getByRole("status")).toHaveTextContent(new RegExp(`^Step 2 of ${TOUR_STEPS.length} · Overview$`));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(dialog()).toHaveAccessibleName(TOUR_STEPS[0].title);
  });

  it("shows the welcome centred with no highlight, then highlights the next step's target: the hole and the ring sit on its box, padded", () => {
    renderApp();
    expect(document.querySelector("[data-tour-ring]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const ring = document.querySelector("[data-tour-ring]");
    expect(ring).toHaveAttribute("x", "12");
    expect(ring).toHaveAttribute("y", "192");
    expect(ring).toHaveAttribute("width", "416");
    expect(document.querySelector("#tour-hole path")?.getAttribute("d")).toContain("M");
    expect(document.querySelector("[data-tour-scrim]")).toHaveClass("tour-scrim");
    // No inline styles anywhere in the overlay (the CSP and the repo's rule).
    expect(document.querySelectorAll("[data-tour-root] [style], [data-tour-root][style]")).toHaveLength(0);
  });

  it("wraps Tab and Shift+Tab through the popover's buttons", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // step 2: Back is enabled
    const d = dialog();
    const skip = within(d).getByRole("button", { name: "Skip tour" });
    const next = within(d).getByRole("button", { name: "Next" });
    next.focus();
    fireEvent.keyDown(next, { key: "Tab" });
    expect(document.activeElement).toBe(skip);
    fireEvent.keyDown(skip, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next);
    // From the heading, Shift+Tab goes to the last button too.
    const heading = within(d).getByRole("heading");
    heading.focus();
    fireEvent.keyDown(heading, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next);
  });

  it("Escape in the popover leaves the tour and gives focus back to where it was", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    renderApp();
    const start = screen.getByRole("button", { name: "Take the tour" });
    start.focus();
    fireEvent.click(start);
    fireEvent.keyDown(within(dialog()).getByRole("heading"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(start);
  });

  it("Escape on the page leaves the tour too, but not while typing in a field", () => {
    renderApp();
    const field = document.createElement("input");
    document.body.append(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(dialog()).toBeInTheDocument();
    field.remove();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape inside another open native dialog (the command palette) is left to it", () => {
    renderApp();
    const palette = document.createElement("dialog");
    palette.setAttribute("open", "");
    const item = document.createElement("button");
    palette.append(item);
    document.body.append(palette);
    fireEvent.keyDown(item, { key: "Escape" });
    const still = document.querySelector("[data-tour-popover]") !== null;
    palette.remove();
    expect(still).toBe(true);
  });

  it("Skip, or Finish on the last step, ends it and writes nothing more", () => {
    renderApp("/app", TOUR_STEPS.slice(0, 3));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Focus goes to the banner's button when where it was is gone (the tour started by itself).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Take the tour" }));

    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    setItem.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveAccessibleName(TOUR_STEPS[2].title);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("the banner's button starts it from the first step, from any page in the app, going to the step's page", async () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    renderApp("/app/power");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/app");
    // Found once the Overview has mounted (the wait's observer and frames run after this click).
    expect(await screen.findByRole("dialog")).toHaveAccessibleName(TOUR_STEPS[0].title);
  });

  it("never undoes a page change made while a step shows (a click through the hole)", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("link", { name: "To Power" }));
    // The highlighted card went with its page: the step stays, centred (seen on the next frame).
    await waitFor(() => expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "fallback"));
    expect(screen.getByTestId("where")).toHaveTextContent("/app/power");
    expect(dialog()).toHaveAccessibleName(TOUR_STEPS[0].title);
  });

  it("a page change that removes the last step's target as the next step's appears leaves the next step highlighted", async () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    function PowerPage() {
      return (
        <div data-page-reveal="revealed">
          <section
            data-tour="power-chart"
            ref={(el) => {
              if (el) el.getBoundingClientRect = rect(20, 100, 300, 200);
            }}
          >
            Chart
          </section>
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <DemoBanner />
        <Routes>
          <Route path="/app" element={<Overview />} />
          <Route path="/app/power" element={<PowerPage />} />
        </Routes>
        <Host steps={[TOUR_STEPS[1], TOUR_STEPS[3]]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    await waitFor(() => expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing"));
    // Frames under the test's hand, as a browser may run one between the next target's discovery and React's render.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const runFrames = () => {
      for (const cb of frames.splice(0)) cb(0);
    };
    try {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      // The new page is committed (the old card gone); the observer finds the chart in a microtask, before React renders.
      await Promise.resolve();
      await Promise.resolve();
      runFrames(); // the old card's frame sees it gone
      await act(async () => {
        await Promise.resolve();
      });
      runFrames();
    } finally {
      vi.unstubAllGlobals();
    }
    await waitFor(() => expect(dialog()).toHaveAccessibleName(TOUR_STEPS[3].title));
    expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing");
    expect(document.querySelector("[data-tour-ring]")).not.toBeNull();
  });

  it("shows a step centred with no highlight when its target never appears, and goes on", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <DemoBanner />
        <Host steps={[{ ...TOUR_STEPS[0], target: "missing" }, TOUR_STEPS[1]]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(dialog()).toHaveAccessibleName(TOUR_STEPS[0].title);
    expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "fallback");
    expect(document.querySelector("[data-tour-ring]")).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("with the opener missing, falls back centred without clicking anything", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    const onOpen = vi.fn();
    const step: TourStep = { id: "panel", path: "/app", target: "panel", openedBy: "absent", title: "The details.", body: "Words.", kind: "next" };
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <DemoBanner />
        <Routes>
          <Route path="/app" element={<Openable onOpen={onOpen} />} />
        </Routes>
        <Host steps={[step, { ...step, id: "b", title: "Second." }]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(dialog()).toHaveAccessibleName("The details.");
    expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "fallback");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("from sm up, attaches the popover beside the target in a foreignObject, with an arrow", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    // jsdom has no layout: a 1440 x 900 viewport.
    const root = document.documentElement;
    Object.defineProperty(root, "clientWidth", { configurable: true, value: 1440 });
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 900 });
    try {
      renderApp();
      // The welcome has no target; the health step does.
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      const fo = dialog().closest("foreignObject");
      expect(fo).not.toBeNull();
      // Below the health card (its box ends at 500, padded to 508), past the arrow.
      expect(fo).toHaveAttribute("data-side", "below");
      expect(Number(fo?.getAttribute("y"))).toBeGreaterThan(508);
      expect(document.querySelector("[data-tour-arrow]")).toHaveAttribute("d");
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(root, "clientWidth");
      Reflect.deleteProperty(root, "clientHeight");
    }
  });

  it("clicks a chain of openers in turn (a view, then a card), each once", async () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    const onView = vi.fn();
    const onOpen = vi.fn();
    const box = (el: HTMLElement | null) => {
      if (el) el.getBoundingClientRect = rect(20, 20, 100, 44);
    };
    function Chained() {
      const [graph, setGraph] = useState(false);
      return (
        <div data-page-reveal="revealed">
          <button type="button" data-tour="view" ref={box} onClick={() => (onView(), setGraph(true))}>
            Graph
          </button>
          {graph && <Openable onOpen={onOpen} />}
        </div>
      );
    }
    const step: TourStep = { id: "panel", path: "/app", target: "panel", openedBy: ["view", "opener"], title: "Inside.", body: "Words.", kind: "next" };
    const other: TourStep = { id: "other", path: "/app", target: "view", title: "Elsewhere.", body: "More words.", kind: "next" };
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <DemoBanner />
        <Routes>
          <Route path="/app" element={<Chained />} />
        </Routes>
        <Host steps={[other, step]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Elsewhere."));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Inside."));
    expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing");
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens a target only a click shows by clicking its opener once, and not when it is already open", async () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    const onOpen = vi.fn();
    const step: TourStep = { id: "panel", path: "/app", target: "panel", openedBy: "opener", title: "The details.", body: "Words.", kind: "next" };
    const other: TourStep = { id: "other", path: "/app", target: "opener", title: "Elsewhere.", body: "More words.", kind: "next" };
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <DemoBanner />
        <Routes>
          <Route path="/app" element={<Openable onOpen={onOpen} />} />
        </Routes>
        <Host steps={[step, other]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("The details.");
    expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing");
    expect(screen.getByText("Panel")).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Back to it with the panel still open: no second click.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Elsewhere."));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName("The details."));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("below sm, is a sheet with no arrow", () => {
    renderApp();
    expect(dialog().closest("[data-tour-sheet]")).not.toBeNull();
    expect(document.querySelector("[data-tour-arrow]")).toBeNull();
  });
});

/**
 * A planner-like page: a drawn card (an SVG `<g>`, no focus of its own) with a visually hidden keyboard button, both
 * opening a panel that closes on Escape and stops it (as GroupPanel does); and a layer checkbox in its label.
 */
function TryPage({ onCard }: { onCard: () => void }) {
  const [open, setOpen] = useState(false);
  const show = () => {
    onCard();
    setOpen(true);
  };
  return (
    <div data-page-reveal="revealed">
      <svg>
        <g
          data-tour="card"
          onClick={show}
          ref={(el) => {
            if (el) el.getBoundingClientRect = rect(20, 20, 200, 80);
          }}
        >
          <rect width="200" height="80" />
        </g>
      </svg>
      <button type="button" data-tour="card-key" className="sr-only" onClick={show}>
        Refinery
      </button>
      {open && (
        <aside
          data-tour="panel"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setOpen(false);
          }}
          ref={(el) => {
            if (el) el.getBoundingClientRect = rect(600, 100, 300, 400);
          }}
        >
          <button type="button">In the panel</button>
        </aside>
      )}
      <label
        data-tour="toggle"
        ref={(el) => {
          if (el) el.getBoundingClientRect = rect(20, 300, 120, 44);
        }}
      >
        <input type="checkbox" />
        Belts and pipes
      </label>
    </div>
  );
}

const CARD: TourStep = {
  id: "card",
  path: "/app",
  target: "card",
  keyTarget: "card-key",
  title: "Open a group.",
  body: "Try it: click the highlighted box.",
  kind: "try",
  done: { appears: "panel" },
  doForMe: true,
};
const PANEL: TourStep = { id: "panel", path: "/app", target: "panel", openedBy: "card", title: "Inside a group.", body: "Words.", kind: "next" };
const TOGGLE: TourStep = {
  id: "toggle",
  path: "/app",
  target: "toggle",
  title: "Choose what to see.",
  body: "Try it: tick the highlighted box.",
  kind: "try",
  done: { changes: "toggle" },
  doForMe: true,
};
const LAST: TourStep = { id: "last", path: "/app", target: "card", title: "The end.", body: "Words.", kind: "next" };

function renderTry(steps: readonly TourStep[], onCard = vi.fn()) {
  window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
  render(
    <MemoryRouter initialEntries={["/app"]}>
      <DemoBanner />
      <Routes>
        <Route path="/app" element={<TryPage onCard={onCard} />} />
      </Routes>
      <Host steps={steps} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
  return onCard;
}

const card = () => document.querySelector<SVGGElement>('[data-tour="card"]')!;

describe("the tour's try-it steps", () => {
  it("moves on by itself when the user clicks the card and the panel appears, and the next step shows the open panel without another click", async () => {
    const onCard = renderTry([CARD, PANEL, LAST]);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Open a group."));
    expect(dialog()).toHaveAccessibleDescription("Try it: click the highlighted box.");
    fireEvent.click(card());
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Inside a group."));
    expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing");
    expect(onCard).toHaveBeenCalledTimes(1);
    // One announcement: done, and where the tour now is.
    expect(screen.getByRole("status")).toHaveTextContent(/^Done\. Step 2 of 3 · Overview$/);
  });

  it("Do it for me clicks the card (an SVG <g>) through its own handler, and the tour moves on", async () => {
    const onCard = renderTry([CARD, PANEL, LAST]);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Open a group."));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Do it for me" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Inside a group."));
    expect(onCard).toHaveBeenCalledTimes(1);
  });

  it("ticking the box moves on, and so does Do it for me, which ticks it", async () => {
    renderTry([TOGGLE, LAST, TOGGLE, LAST]);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Choose what to see."));
    const box = screen.getByRole("checkbox", { name: "Belts and pipes" });
    fireEvent.click(box);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("The end."));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Choose what to see."));
    expect(box).toBeChecked();
    // Already ticked: Do it for me must not untick it; the step just goes on.
    fireEvent.click(within(dialog()).getByRole("button", { name: "Do it for me" }));
    expect(box).toBeChecked();
    await waitFor(() => expect(within(dialog()).getByText("Step 4 of 4 · Overview")).toBeInTheDocument());
  });

  it("when nothing happens, Next still moves on (and the next step's opener opens the panel)", async () => {
    const onCard = renderTry([CARD, PANEL, LAST]);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Open a group."));
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Inside a group."));
    expect(onCard).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(/^Step 2 of 3 · Overview$/);
  });

  it("Do it for me with no answer from the page goes on as Next after the wait", async () => {
    vi.useFakeTimers();
    renderTry([{ ...CARD, done: { appears: "never" } }, LAST]);
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(dialog()).toHaveAccessibleName("Open a group.");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Do it for me" }));
    // It stays, disabled, so the button row does not shift while the step finishes (ui-reviewer).
    expect(within(dialog()).getByRole("button", { name: "Do it for me" })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(5900));
    expect(dialog()).toHaveAccessibleName("Open a group.");
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(dialog()).toHaveAccessibleName("The end.");
  });

  it("Escape with the panel open closes the panel first; the next Escape leaves the tour", async () => {
    renderTry([CARD, PANEL, LAST]);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Open a group."));
    fireEvent.click(card());
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Inside a group."));
    fireEvent.keyDown(screen.getByRole("button", { name: "In the panel" }), { key: "Escape" });
    expect(document.querySelector('[data-tour="panel"]')).toBeNull();
    expect(dialog()).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Tab wraps through the popover's buttons and the target's keyboard path, both ways", async () => {
    renderTry([CARD, PANEL, LAST]);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Open a group."));
    const d = dialog();
    const skip = within(d).getByRole("button", { name: "Skip tour" });
    const next = within(d).getByRole("button", { name: "Next" });
    const key = screen.getByRole("button", { name: "Refinery" });
    next.focus();
    fireEvent.keyDown(next, { key: "Tab" });
    expect(document.activeElement).toBe(key);
    fireEvent.keyDown(key, { key: "Tab" });
    expect(document.activeElement).toBe(skip);
    fireEvent.keyDown(skip, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(key);
    fireEvent.keyDown(key, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next);
    // The keyboard path opens the panel, which finishes the step.
    fireEvent.click(key);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Inside a group."));
  });

  it("Tab reaches a checkbox inside a label target", async () => {
    renderTry([TOGGLE, LAST]);
    await waitFor(() => expect(dialog()).toHaveAccessibleName("Choose what to see."));
    const next = within(dialog()).getByRole("button", { name: "Next" });
    next.focus();
    fireEvent.keyDown(next, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Belts and pipes" }));
  });
});

/** The top nav's tabs, marked as the shell marks them (`tour(tabTarget(path))`). */
function Nav() {
  return (
    <nav aria-label="Main">
      <a
        href="/app"
        data-tour="tab-overview"
        ref={(el) => {
          if (el) el.getBoundingClientRect = rect(0, 0, 90, 44);
        }}
      >
        Overview
      </a>
      <a
        href="/app/power"
        data-tour="tab-power"
        ref={(el) => {
          if (el) el.getBoundingClientRect = rect(90, 0, 80, 44);
        }}
      >
        Power
      </a>
    </nav>
  );
}

/** The Power page, its chart still laying out (its box moving every read) until `chart.still` is set. */
const chart = { still: false, x: 20 };
function LayingOutPower() {
  return (
    <div data-page-reveal="revealed">
      <section
        data-tour="power-chart"
        ref={(el) => {
          if (!el) return;
          el.getBoundingClientRect = () => {
            if (!chart.still) chart.x += 4;
            return rect(chart.x, 100, 300, 200)();
          };
        }}
      >
        Chart
      </section>
    </div>
  );
}

const ringOf = (selector: string) => {
  const ring = document.querySelector(selector);
  return ring === null ? null : ["x", "y", "width", "height"].map((a) => Number(ring.getAttribute(a)));
};
const holes = () => (document.querySelector("#tour-hole path")?.getAttribute("d") ?? "").match(/Z/g)?.length ?? 0;

describe("moving to a new page, and which tab a step is on", () => {
  beforeEach(() => {
    chart.still = false;
    chart.x = 20;
  });

  function renderPages(props: Partial<ComponentProps<typeof TourHost>> = {}) {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <DemoBanner />
        <Nav />
        <Routes>
          <Route path="/app" element={<Overview />} />
          <Route path="/app/power" element={<LayingOutPower />} />
        </Routes>
        <TourHost steps={[TOUR_STEPS[1], TOUR_STEPS[3]]} warm={() => {}} {...props} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
  }

  it("while the next page settles: only the plain scrim (no hole, ring, tab or popover from the last step), focus kept in the tour; then the step, once its box keeps still", async () => {
    renderPages();
    await waitFor(() => expect(dialog()).toHaveAccessibleName(TOUR_STEPS[1].title));
    expect(holes()).toBe(3); // the viewport, the health card and the Overview tab

    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(document.querySelector("[data-tour-popover]")).toBeNull();
    expect(document.querySelector("[data-tour-ring]")).toBeNull();
    expect(document.querySelector("[data-tour-tab-ring]")).toBeNull();
    expect(holes()).toBe(1);
    expect(dialog()).toHaveAccessibleName("Guided tour");
    expect(document.activeElement).toBe(document.querySelector("[data-tour-waiting]"));

    // The chart keeps moving: still waiting, well past the settling time.
    await new Promise((r) => setTimeout(r, TOUR_SETTLE_MS * 2));
    expect(document.querySelector("[data-tour-popover]")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("[data-tour-waiting]"));

    chart.still = true;
    await waitFor(() => expect(dialog()).toHaveAccessibleName(TOUR_STEPS[3].title));
    expect(document.querySelector("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing");
    expect(ringOf("[data-tour-ring]")).toEqual([chart.x - 8, 92, 316, 216]);
    expect(document.activeElement).toBe(within(dialog()).getByRole("heading", { name: TOUR_STEPS[3].title }));
    expect(within(dialog()).getByText(`Step 2 of 2 · Power`)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^Step 2 of 2 · Power$/);
  });

  it("Escape while the next page settles (focus on the holder, no popover or Skip) still leaves the tour", async () => {
    renderPages();
    await waitFor(() => expect(dialog()).toHaveAccessibleName(TOUR_STEPS[1].title));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    const holder = document.querySelector("[data-tour-waiting]") as HTMLElement;
    expect(document.activeElement).toBe(holder);
    fireEvent.keyDown(holder, { key: "Escape" });
    expect(document.querySelector("[data-tour-root]")).toBeNull();
    expect(document.querySelector("[data-tour-waiting]")).toBeNull();
  });

  it("cuts a second, quieter hole round the step's tab, its ring muted, not the accent", async () => {
    chart.still = true;
    renderPages({ settleMs: 0 });
    await waitFor(() => expect(dialog()).toHaveAccessibleName(TOUR_STEPS[1].title));
    // The Overview tab (0, 0, 90, 44), padded by 2.
    expect(ringOf("[data-tour-tab-ring]")).toEqual([-2, -2, 94, 48]);
    expect(document.querySelector("[data-tour-tab-ring]")).toHaveClass("stroke-muted");
    expect(document.querySelector("[data-tour-tab-ring]")).not.toHaveClass("stroke-accent");
    const d = document.querySelector("#tour-hole path")?.getAttribute("d") ?? "";
    expect(d).toContain("M"); // both rects in the one evenodd path
    expect(holes()).toBe(3);

    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName(TOUR_STEPS[3].title));
    await waitFor(() => expect(ringOf("[data-tour-tab-ring]")).toEqual([88, -2, 84, 48]));
  });

  it("warms the tour's pages once as it starts, with the app's query client and server", async () => {
    const warm = vi.fn();
    const client = new QueryClient();
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    render(
      <QueryClientProvider client={client}>
        <ServerContext.Provider value={{ id: "s1" } as ServerSummary}>
          <MemoryRouter initialEntries={["/app"]}>
            <DemoBanner />
            <Routes>
              <Route path="/app" element={<Overview />} />
            </Routes>
            <TourHost steps={TOUR_STEPS.slice(0, 3)} settleMs={0} warm={warm} schedule={(task) => (task(), () => {})} />
          </MemoryRouter>
        </ServerContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(dialog()).toHaveAccessibleName(TOUR_STEPS[1].title));
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledWith(TOUR_STEPS.slice(0, 3), { client, serverId: "s1" });
  });
});

describe("the banner's button", () => {
  it("is shown only where the tour's host is mounted (inside the app)", () => {
    render(
      <MemoryRouter>
        <DemoBanner />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Take the tour" })).not.toBeInTheDocument();
    expect(screen.getByText(/Demo data: nothing here is live/)).toBeInTheDocument();
  });
});
