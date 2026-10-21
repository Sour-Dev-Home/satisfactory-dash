import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { powerOk, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext, ServerSwitchContext } from "../servers/ServerContext";
import { CommandBar } from "../shell/Shell";
import { renderWithClient } from "../test/render";

beforeAll(() => {
  // cmdk measures its list and scrolls the selected item into view; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= vi.fn();
});

function Where() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="URL">{`${pathname}${search}${hash}`}</output>;
}

function barTree({ serverCount = 1, change = vi.fn(), withButton = true } = {}) {
  return (
    <MemoryRouter initialEntries={["/app"]}>
      <ServerContext value={serversSingle.servers[0]}>
        <ServerSwitchContext value={{ serverCount, change, select: vi.fn() }}>
          {withButton && <button type="button">Somewhere else</button>}
          <CommandBar />
          <Where />
        </ServerSwitchContext>
      </ServerContext>
    </MemoryRouter>
  );
}

function renderBar({ serverCount = 1, change = vi.fn() } = {}) {
  const view = renderWithClient(barTree({ serverCount, change }));
  return { ...view, change };
}

const pressCtrlK = () => act(() => void fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
/**
 * The search box, once the bar has opened. #504: every first open in a test suspends on the lazy chunk (#387), and
 * React then holds the fallback for its fixed ~300 ms Suspense throttle before showing the box. That is a real wait
 * inside findByRole's 1 s default, which left too little room on a fully loaded machine. Same assertion, a budget
 * that covers the throttle.
 */
const searchBox = (scope: Pick<typeof screen, "findByRole"> = screen) => scope.findByRole("combobox", {}, { timeout: 3000 });
/** Ctrl+K, then the search box. */
const openWithKeys = async () => {
  pressCtrlK();
  return searchBox();
};
const input = () => screen.getByRole("combobox");

describe("CommandBar (#351)", () => {
  it("is closed until Ctrl+K opens it, focused on the search box", async () => {
    renderBar();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await openWithKeys();
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(input()).toHaveFocus();
    expect(screen.getByRole("option", { name: "Power" })).toBeInTheDocument();
  });

  it("opens from the header's Search button too (touch)", async () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Search (Ctrl+K)" }));
    expect(await searchBox()).toHaveFocus();
  });

  it("filters as you type, and Enter jumps to the match", async () => {
    renderBar();
    await openWithKeys();
    fireEvent.change(input(), { target: { value: "alerts" } });
    await waitFor(() => expect(screen.queryByRole("option", { name: "Power" })).not.toBeInTheDocument());
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent("/app/settings#alerts");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    renderBar();
    await openWithKeys();
    fireEvent.change(input(), { target: { value: "zzzz-no-such-thing" } });
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
  });

  it("lists the power circuits once they're read, linking to the card", async () => {
    renderBar();
    await openWithKeys();
    const circuit = powerOk.data.circuits[0];
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^Circuit ${circuit.circuitGroupId}`) }));
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent(`/app/power#circuit-${circuit.circuitGroupId}`);
  });

  it("closes on Esc and puts focus back where it was", async () => {
    renderBar();
    const before = screen.getByRole("button", { name: "Somewhere else" });
    before.focus();
    await openWithKeys();
    fireEvent(screen.getByRole("dialog", { name: "Search" }), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(before).toHaveFocus();
  });

  it("toggles closed on a second Ctrl+K", async () => {
    renderBar();
    await openWithKeys();
    pressCtrlK();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers Change server with more than one server, and runs it", async () => {
    const { change } = renderBar({ serverCount: 2 });
    await openWithKeys();
    const dialog = screen.getByRole("dialog", { name: "Search" });
    fireEvent.click(within(dialog).getByRole("option", { name: "Change server" }));
    expect(change).toHaveBeenCalledOnce();
  });

  it("opens even when a text input elsewhere has focus (the shortcut works everywhere)", async () => {
    renderBar();
    const external = document.createElement("input");
    document.body.appendChild(external);
    external.focus();
    expect(external).toHaveFocus();
    // Dispatched at the focused input, like a real keypress: it must bubble to the window listener.
    act(() => void fireEvent.keyDown(external, { key: "k", ctrlKey: true }));
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    await searchBox();
    document.body.removeChild(external);
  });

  it("removes the global keydown listener on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderBar();
    const [, handler] = addSpy.mock.calls.find(([type]) => type === "keydown")!;
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", handler);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("doesn't throw closing when the element to restore focus to was unmounted while open", async () => {
    const { client, rerender, change } = renderBar();
    const before = screen.getByRole("button", { name: "Somewhere else" });
    before.focus();
    await openWithKeys();
    // The page behind the palette re-renders without the element that used to hold focus.
    rerender(<QueryClientProvider client={client}>{barTree({ change, withButton: false })}</QueryClientProvider>);
    expect(screen.queryByRole("button", { name: "Somewhere else" })).not.toBeInTheDocument();
    expect(() =>
      fireEvent(screen.getByRole("dialog", { name: "Search" }), new Event("cancel", { cancelable: true })),
    ).not.toThrow();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("matches on a keyword alone (cmdk really passes Item's keywords into the filter, not just the label)", async () => {
    renderBar();
    await openWithKeys();
    // "discord" is only in settings-alerts' keywords, never in its label "Alerts".
    fireEvent.change(input(), { target: { value: "discord" } });
    expect(await screen.findByRole("option", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Power" })).not.toBeInTheDocument();
  });

  it("doesn't match a word that's only in a hint, never passed as a keyword", async () => {
    renderBar();
    await openWithKeys();
    // Every circuit's hint reads "... MW of ... MW", but hints aren't part of Item's keywords.
    fireEvent.change(input(), { target: { value: "MW" } });
    await screen.findByText("Nothing matches.");
  });

  it("keeps commands that tie in score in their original (paletteGroups) order", async () => {
    renderBar();
    await openWithKeys();
    // factoryMixed has four "Assembler" machines (one per recipe); all four labels start with
    // "Assembler", so they all tie at score 1 and should stay in paletteGroups' sorted order
    // (recipe name, "" for none) rather than being reshuffled by cmdk.
    fireEvent.change(input(), { target: { value: "assembler" } });
    const options = await screen.findAllByRole("option");
    // The label lives in the option's first span; a second span (when present) is the hint, which
    // would otherwise run into the label with no separator in textContent.
    const assemblerLabels = options
      .map((o) => o.querySelector("span")?.textContent)
      .filter((l) => l?.startsWith("Assembler"));
    expect(assemblerLabels).toEqual([
      "Assembler",
      "Assembler · Alternate: Coated Iron Canister",
      "Assembler · Reinforced Iron Plate",
      "Assembler · Stator",
    ]);
  });

  it("does nothing on Enter when nothing matches: stays open, doesn't navigate", async () => {
    renderBar();
    await openWithKeys();
    fireEvent.change(input(), { target: { value: "zzzz-no-such-thing" } });
    await screen.findByText("Nothing matches.");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent("/app");
  });
});

describe("CommandBar's lazy chunk (#387)", () => {
  const missingChunk = () => new TypeError("Failed to fetch dynamically imported module: /assets/CommandBar-x.js");
  const realPalette = () => import("./CommandBar").then((m) => ({ default: m.Palette }));
  afterEach(() => vi.restoreAllMocks());

  function renderWith(load: () => Promise<{ default: typeof import("./CommandBar").Palette }>) {
    return renderWithClient(
      <MemoryRouter initialEntries={["/app"]}>
        <ServerContext value={serversSingle.servers[0]}>
          <ServerSwitchContext value={{ serverCount: 1, change: vi.fn(), select: vi.fn() }}>
            <CommandBar load={load} />
          </ServerSwitchContext>
        </ServerContext>
      </MemoryRouter>,
    );
  }

  it("loads the palette on the first open only, inside the dialog, and not again on the second", async () => {
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const load = vi.fn(() => gate.then(realPalette));
    renderWith(load);
    // Nothing is fetched until the bar opens.
    expect(load).not.toHaveBeenCalled();

    pressCtrlK();
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(within(dialog).getByText("Loading search…")).toBeInTheDocument();
    finish();
    expect(await searchBox(within(dialog))).toHaveFocus();
    expect(within(dialog).queryByText("Loading search…")).not.toBeInTheDocument();

    pressCtrlK();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // Second open: already loaded, so the search box is there at once, with no loading state.
    // It mounts before the shell opens the dialog, so autoFocus finds it unfocusable (inside a
    // closed, display:none dialog); the palette focuses it again once the dialog is open (#386).
    pressCtrlK();
    const search = screen.getByRole("combobox");
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.queryByText("Loading search…")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();
  });

  it("drops the queued refocus when the bar closes again before it runs (#386)", async () => {
    const load = vi.fn(realPalette);
    renderWith(load);
    pressCtrlK();
    expect(await searchBox()).toHaveFocus();
    pressCtrlK();

    // Reopen and close in the same tick: the palette unmounts before its refocus runs.
    pressCtrlK();
    const search = screen.getByRole("combobox");
    pressCtrlK();
    await act(async () => {});
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(search).not.toHaveFocus();
  });

  it("says so when the chunk fails to load (offline) and never reloads the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const load = vi.fn(() => Promise.reject(missingChunk()));
    renderWith(load);
    pressCtrlK();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Search couldn't load. Check your connection, then try again.");
    expect(within(alert).getByRole("button", { name: "Try again" })).toHaveFocus();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // #325's reloadOnce marks a reload in session storage before it reloads: it never ran.
    expect(setItem).not.toHaveBeenCalled();
  });

  it("Try again imports afresh, and the search shows once the chunk loads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi.fn<() => ReturnType<typeof realPalette>>().mockRejectedValueOnce(missingChunk()).mockImplementation(realPalette);
    renderWith(load);
    pressCtrlK();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await searchBox()).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("closing while the chunk is still loading, then opening again, shows the search once it arrives", async () => {
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const load = vi.fn(() => gate.then(realPalette));
    renderWith(load);
    pressCtrlK();
    expect(screen.getByText("Loading search…")).toBeInTheDocument();
    pressCtrlK();
    expect(screen.queryByText("Loading search…")).not.toBeInTheDocument();
    pressCtrlK();
    finish();
    expect(await searchBox()).toHaveFocus();
    expect(load).toHaveBeenCalledOnce();
  });

  it("closing after a failure and opening again retries the import", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi.fn<() => ReturnType<typeof realPalette>>().mockRejectedValueOnce(missingChunk()).mockImplementation(realPalette);
    renderWith(load);
    pressCtrlK();
    await screen.findByRole("alert");
    pressCtrlK();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    pressCtrlK();
    expect(await searchBox()).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
