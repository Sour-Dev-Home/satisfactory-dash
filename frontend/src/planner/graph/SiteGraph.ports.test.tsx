import { act, fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { PlannerView } from "../PlannerView";
import { clearLayoutMemo } from "./layoutSite";

// ADR-0063: item ports on the card edges (build PR 2; the flag removed in build PR 7).

beforeEach(() => {
  window.localStorage.clear();
  clearLayoutMemo();
});
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

async function openGraph(prefs: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(prefs)) window.localStorage.setItem(k, v);
  renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
  fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
  return screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 });
}

const lines = (svg: HTMLElement) => [...svg.querySelectorAll<SVGPathElement>('[data-edge-layer="lines"] [data-edge] > path:first-of-type')];

describe("ports", () => {
  it("draws a disc per port inside its card, an input on the left and an output on the right, each with its words", async () => {
    const svg = await openGraph();
    const ports = [...svg.querySelectorAll("[data-port]")];
    expect(ports.length).toBeGreaterThan(0);    for (const p of ports) {
      // Part of the card: inside its group, so a click on it is the card's.
      expect(p.closest("[data-card]")).not.toBeNull();
      // A return flow's ports are the other way round (out on the left, in on the right).
      const inSide = p.hasAttribute("data-port-returning") ? "r" : "l";
      expect(p.getAttribute("data-port-side")).toBe(p.getAttribute("data-port-dir") === "in" ? inSide : inSide === "l" ? "r" : "l");
      expect(p.querySelector("title")?.textContent).toMatch(/ (in|out), /);
      // Never blank: an icon, or its initials.
      expect(p.querySelector("image, text")).not.toBeNull();
    }
    // Nothing new to tab to.
    for (const p of ports) expect(p.querySelector("[tabindex]")).toBeNull();
  });

  it("keeps every line's arrowhead, into an input port too (open question 5: the owner kept it, 2026-11-05)", async () => {
    const svg = await openGraph();
    expect(svg.querySelector("[data-port]")).not.toBeNull();
    expect(lines(svg).length).toBeGreaterThan(0);
    for (const l of lines(svg)) expect(l).toHaveAttribute("marker-end");
  });
});

// ADR-0063 build PR 5: a selected card dims to its neighbours (state 4), and "Show what … feeds and needs" (state 2).
describe("focus states", () => {
  const dimmedCards = (svg: Element) => svg.querySelectorAll("[data-card][data-dim]").length;

  it("dims to the open card's neighbours, says so, and the panel's button shows what it feeds and needs; Escape steps back", async () => {
    const svg = await openGraph();
    expect(dimmedCards(svg)).toBe(0);
    // A click on a card opens its panel.
    const cards = [...svg.querySelectorAll("[data-card]")];
    fireEvent.click(cards[cards.length - 1]);
    const status = screen.getByRole("status");
    await screen.findByText(/^Showing .+ and its neighbours$/);
    const neighboursOnly = dimmedCards(svg);
    const panel = await screen.findByRole("complementary");
    const button = within(panel).getByRole("button", { name: /^Show what .+ feeds and needs$/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(status).toHaveTextContent(/^Showing what .+ feeds and needs: \d+ of \d+ cards$/);
    // What it feeds and needs reaches at least as far as its neighbours.
    expect(dimmedCards(svg)).toBeLessThanOrEqual(neighboursOnly);
    // Escape ends "feeds and needs" first, then closes the panel (which ends the neighbours' dimming).
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(status).toHaveTextContent(/and its neighbours$/);
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(dimmedCards(svg)).toBe(0);
  });

  it("does not bring 'feeds and needs' back when the first card is reopened after another", async () => {
    const svg = await openGraph();
    const cards = [...svg.querySelectorAll("[data-card]")];
    expect(cards.length).toBeGreaterThan(1);
    fireEvent.click(cards[cards.length - 1]);
    fireEvent.click(within(await screen.findByRole("complementary")).getByRole("button", { name: /^Show what .+ feeds and needs$/ }));
    expect(screen.getByRole("status")).toHaveTextContent(/^Showing what /);
    fireEvent.click(cards[0]);
    fireEvent.click(cards[cards.length - 1]);
    const again = within(await screen.findByRole("complementary")).getByRole("button", { name: /^Show what .+ feeds and needs$/ });
    expect(again).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).not.toHaveTextContent(/^Showing what /);
  });
});

// ADR-0063 build PR 3: end labels, and the middle bubble as the fallback.
describe("end labels", () => {
  it("draws a name and a rate beside each port whose label fits, and leaves those lines' middles empty", async () => {
    const svg = await openGraph();
    const labels = [...svg.querySelectorAll("[data-end-label]")];
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      const [name, rate] = [...l.querySelectorAll("text")];
      expect(name.textContent).not.toBe("");
      // The rate follows the amendment's rule: hidden at rest with a mouse (index.css), drawn by the highlight layer.
      if (rate !== undefined) expect(rate).toHaveAttribute("data-rate");
    }
    // An end-labelled line draws no bubbles in its middle (a transport keeps only its resting glyph there).
    for (const g of svg.querySelectorAll("[data-end-labelled]")) expect(g.querySelector("[data-bubble]")).toBeNull();
    // Decorative: nothing new to tab to.
    expect(svg.querySelector("[data-end-labels] [tabindex]")).toBeNull();
  });

  it("is a picture with item focus off: a click on a label does nothing", async () => {
    const svg = await openGraph();
    const label = svg.querySelector("[data-end-label]")!;
    expect(label).not.toHaveClass("cursor-pointer");
    fireEvent.click(label);
    // With ports on the status line stays mounted (PR 5's states speak there); a click on a label says nothing in it.
    expect(screen.queryByRole("status")?.textContent ?? "").toBe("");
  });

  it("with item focus on, a port of one line focuses its item; a port of several opens their list", async () => {
    const svg = await openGraph({ "planner.itemFocus": "on" });
    const single = svg.querySelector('[data-end-label][data-lines="1"]');
    expect(single).not.toBeNull();
    fireEvent.click(single!);
    expect(await screen.findByRole("status")).toHaveTextContent(/^Focused /);
    // And it stays focused: the click is not also a press on the background, which would leave focus.
    expect(screen.getByRole("status")).not.toHaveTextContent(/^Left focus|^$/);
    const several = svg.querySelector('[data-end-label]:not([data-lines="1"])');
    if (several !== null) {
      fireEvent.click(several);
      const list = await screen.findByRole("region", { name: /^\d+ lines of / });
      fireEvent.keyDown(list, { key: "Escape" });
      expect(screen.queryByRole("region", { name: /^\d+ lines of / })).toBeNull();
      // ADR-0063 build PR 4: the canvas's Escape chain closes it too, first, with the keyboard outside the panel.
      fireEvent.click(svg.querySelector('[data-end-label]:not([data-lines="1"])')!);
      await screen.findByRole("region", { name: /^\d+ lines of / });
      fireEvent.keyDown(svg, { key: "Escape" });
      expect(screen.queryByRole("region", { name: /^\d+ lines of / })).toBeNull();
    }
  });
});
