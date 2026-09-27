import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { powerOk, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext, ServerSwitchContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { CommandBar } from "./CommandBar";

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
        <ServerSwitchContext value={{ serverCount, change }}>
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

const openWithKeys = () => act(() => void fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
const input = () => screen.getByRole("combobox");

describe("CommandBar (#351)", () => {
  it("is closed until Ctrl+K opens it, focused on the search box", () => {
    renderBar();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    openWithKeys();
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(input()).toHaveFocus();
    expect(screen.getByRole("option", { name: "Power" })).toBeInTheDocument();
  });

  it("opens from the header's Search button too (touch)", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Search (Ctrl+K)" }));
    expect(input()).toHaveFocus();
  });

  it("filters as you type, and Enter jumps to the match", async () => {
    renderBar();
    openWithKeys();
    fireEvent.change(input(), { target: { value: "alerts" } });
    await waitFor(() => expect(screen.queryByRole("option", { name: "Power" })).not.toBeInTheDocument());
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent("/app/settings#alerts");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    renderBar();
    openWithKeys();
    fireEvent.change(input(), { target: { value: "zzzz-no-such-thing" } });
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
  });

  it("lists the power circuits once they're read, linking to the card", async () => {
    renderBar();
    openWithKeys();
    const circuit = powerOk.data.circuits[0];
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^Circuit ${circuit.circuitGroupId}`) }));
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent(`/app/power#circuit-${circuit.circuitGroupId}`);
  });

  it("closes on Esc and puts focus back where it was", () => {
    renderBar();
    const before = screen.getByRole("button", { name: "Somewhere else" });
    before.focus();
    openWithKeys();
    fireEvent(screen.getByRole("dialog", { name: "Search" }), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(before).toHaveFocus();
  });

  it("toggles closed on a second Ctrl+K", () => {
    renderBar();
    openWithKeys();
    openWithKeys();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers Change server with more than one server, and runs it", () => {
    const { change } = renderBar({ serverCount: 2 });
    openWithKeys();
    const dialog = screen.getByRole("dialog", { name: "Search" });
    fireEvent.click(within(dialog).getByRole("option", { name: "Change server" }));
    expect(change).toHaveBeenCalledOnce();
  });

  it("opens even when a text input elsewhere has focus (the shortcut works everywhere)", () => {
    renderBar();
    const external = document.createElement("input");
    document.body.appendChild(external);
    external.focus();
    expect(external).toHaveFocus();
    // Dispatched at the focused input, like a real keypress: it must bubble to the window listener.
    act(() => void fireEvent.keyDown(external, { key: "k", ctrlKey: true }));
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
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

  it("doesn't throw closing when the element to restore focus to was unmounted while open", () => {
    const { client, rerender, change } = renderBar();
    const before = screen.getByRole("button", { name: "Somewhere else" });
    before.focus();
    openWithKeys();
    // The page behind the palette re-renders without the element that used to hold focus.
    rerender(<QueryClientProvider client={client}>{barTree({ change, withButton: false })}</QueryClientProvider>);
    expect(screen.queryByRole("button", { name: "Somewhere else" })).not.toBeInTheDocument();
    expect(() =>
      fireEvent(screen.getByRole("dialog", { name: "Search" }), new Event("cancel", { cancelable: true })),
    ).not.toThrow();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("does nothing on Enter when nothing matches: stays open, doesn't navigate", async () => {
    renderBar();
    openWithKeys();
    fireEvent.change(input(), { target: { value: "zzzz-no-such-thing" } });
    await screen.findByText("Nothing matches.");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent("/app");
  });
});
