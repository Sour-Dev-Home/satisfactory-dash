import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { factoryMixed, productionGraphFactories, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { MACHINES_FRAME_NOTE } from "./canvasScene";
import { clearFoldMemory } from "./foldMemory";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearFoldMemory();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const SMELTER = DATA.nodes.find((n) => n.className === "Build_SmelterMk1_C")!;
const base = factoryMixed.data.buildings[0];
const smelter = (id: string, state: string) => ({
  ...base,
  id,
  name: "Smelter",
  state,
  clockSpeedPercent: 100,
  production: [{ className: "Desc_IronIngot_C", name: "Iron Ingot", unit: "items/min" as const, currentPerMinute: 30, maxPerMinute: 30, percent: 100 }],
});

beforeEach(() => {
  // The smelter group lists three of its four machines; the Factory read holds two of them.
  const graph = { ...productionGraphFactories, data: { ...DATA, nodes: DATA.nodes.map((n) => (n === SMELTER ? { ...n, machineIds: ["sm1", "sm2", "sm3"] } : n)) } };
  server.use(
    http.get(endpoints.productionGraph.route, () => HttpResponse.json(graph)),
    http.get(endpoints.factory.route, () => HttpResponse.json({ ...factoryMixed, data: { ...factoryMixed.data, buildings: [smelter("sm1", "producing"), smelter("sm2", "underfed")] } })),
  );
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener: () => {}, removeEventListener: () => {} }));
});

function renderView() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

async function openPlate() {
  renderView();
  await screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
  fireEvent.click(await screen.findByRole("button", { name: /^Open factory: Iron Plate factory./ }));
  return screen.findByRole("img", { name: /^Graph of Iron Plate factory/ }, { timeout: 3_000 });
}

const expandButton = () => screen.getByRole("button", { name: /^Expand 4× Smelter.* into its 4 machines$/ });
const cardButton = () => screen.getByRole("button", { name: /^4× Smelter, Iron Ingot/ });
const machineList = () => screen.queryByRole("list", { name: /^Machines in 4× Smelter/ });

describe("a group card opened into its machines", () => {
  it("has an Expand control on the card and in the DOM layer; opened, a frame of one card per machine and a +k more", async () => {
    const svg = await openPlate();
    const card = svg.querySelector(`[data-node="${CSS.escape(SMELTER.key)}"]`)!;
    expect(card.querySelector("[data-machines-expand]")).not.toBeNull();
    expect(expandButton()).toHaveAttribute("aria-expanded", "false");
    expect(machineList()).toBeNull();
    fireEvent.click(card.querySelector("[data-machines-expand]")!);
    const frame = svg.querySelector(`[data-node="${CSS.escape(SMELTER.key)}"]`)!;
    expect(frame).toHaveAttribute("data-machines-open");
    expect([...frame.querySelectorAll("[data-machine]")].map((m) => m.getAttribute("data-machine"))).toEqual(["sm1", "sm2", "sm3", "more"]);
    // The words: from the Factory read where it has the machine, from the group where it does not.
    expect(within(frame as HTMLElement).getAllByText("Smelter")).toHaveLength(3);
    expect(within(frame as HTMLElement).getByText("Producing")).toBeInTheDocument();
    expect(within(frame as HTMLElement).getByText("Underfed")).toBeInTheDocument();
    expect(within(frame as HTMLElement).getByText("State not read")).toBeInTheDocument();
    expect(within(frame as HTMLElement).getByText("Makes Iron Ingot")).toBeInTheDocument();
    expect(within(frame as HTMLElement).getByText("+1 more machine")).toBeInTheDocument();
    // The frame says why its lines join it, in its tooltip and its button's name.
    expect(cardButton().getAttribute("aria-label")).toContain(MACHINES_FRAME_NOTE);
    expect(frame.querySelector("title")!.textContent).toContain(MACHINES_FRAME_NOTE);
    // Each machine is a real button in the DOM layer.
    const buttons = within(machineList()!).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Smelter, machine 1 of 4: Producing. Iron Ingot: 30 / 30 items/min",
      "Smelter, machine 2 of 4: Underfed. Iron Ingot: 30 / 30 items/min",
      "Smelter, machine 3 of 4: State not read. Makes Iron Ingot. Not in the factory read: its rate is read per group",
      "1 more machine in Smelter: open the group panel",
    ]);
  });

  it("from the keyboard: Expand moves focus to the first machine, a machine opens the panel marking it, Escape steps back", async () => {
    await openPlate();
    fireEvent.click(expandButton());
    const first = await screen.findByRole("button", { name: /^Smelter, machine 1 of 4/ });
    expect(first).toHaveFocus();
    expect(screen.getByRole("button", { name: /^Collapse the machines of 4× Smelter/ })).toHaveAttribute("aria-expanded", "true");
    const second = screen.getByRole("button", { name: /^Smelter, machine 2 of 4/ });
    second.focus();
    fireEvent.click(second);
    const panel = await screen.findByRole("complementary", { name: /^4× Smelter/ });
    const marked = await within(panel).findByText("Underfed");
    expect(marked.closest("li")).toHaveAttribute("aria-current", "true");
    expect(second).toHaveAttribute("aria-current", "true");
    // Escape: the panel closes and the keyboard is back on that machine; again, the group folds and it is on the card.
    fireEvent.keyDown(within(panel).getByRole("button", { name: "Close" }), { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: /^4× Smelter/ })).toBeNull();
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "Escape" });
    expect(machineList()).toBeNull();
    expect(cardButton()).toHaveFocus();
    expect(expandButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("the +k more card opens the group panel", async () => {
    await openPlate();
    fireEvent.click(expandButton());
    fireEvent.click(await screen.findByRole("button", { name: "1 more machine in Smelter: open the group panel" }));
    expect(await screen.findByRole("complementary", { name: /^4× Smelter/ })).toBeInTheDocument();
  });

  it("Collapse on the frame and Collapse all fold it back", async () => {
    const svg = await openPlate();
    fireEvent.click(expandButton());
    fireEvent.click(svg.querySelector("[data-machines-collapse]")!);
    expect(svg.querySelector("[data-machines-open]")).toBeNull();
    fireEvent.click(expandButton());
    expect(svg.querySelector("[data-machines-open]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(svg.querySelector("[data-machines-open]")).toBeNull();
    expect(machineList()).toBeNull();
  });

  it("is remembered for the factory across a visit to All factories", async () => {
    await openPlate();
    fireEvent.click(expandButton());
    fireEvent.click(screen.getByRole("button", { name: "All factories" }));
    await screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
    fireEvent.click(await screen.findByRole("button", { name: /^Open factory: Iron Plate factory./ }));
    const svg = await screen.findByRole("img", { name: /^Graph of Iron Plate factory/ }, { timeout: 3_000 });
    expect(svg.querySelector("[data-machines-open]")).not.toBeNull();
    expect(machineList()).not.toBeNull();
  });

  it("offers no Expand on a group of one machine", async () => {
    await openPlate();
    expect(screen.queryByRole("button", { name: /^Expand .*Storage Container/ })).toBeNull();
    const names = screen.getAllByRole("button", { name: /^Expand / }).map((b) => b.textContent);
    expect(names.every((n) => !/^Expand 1×|into its 1 machines/.test(n ?? ""))).toBe(true);
  });
});
