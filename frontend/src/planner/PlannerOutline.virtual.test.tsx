import { fireEvent, waitFor } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type PlannerNode } from "@satisfactory-dash/shared";
import { outlineRowOf, outlineRows, renderOutline } from "../test/outline";
import { plannerLarge } from "../test/scenarios";
import { mountsFirst, OUTLINE_CURRENT_BEFORE, OUTLINE_FIRST_ROWS } from "./outlineModel";
import { PlannerOutline } from "./PlannerOutline";

// ADR-0062 Decision 3, cost (virtualised 2026-11-01): the outline mounts a screen of rows first and the rest in a
// transition right after; no row is ever left out of the DOM once it settles, and each group row lets the browser skip
// its layout off screen (`outline-row-lazy`).

const LARGE = ProductionGraphResponseSchema.parse(plannerLarge).data;
// planner-large's groups share one name; each gets its own here, so a row and a neighbour's button can be told apart.
const NODES: PlannerNode[] = LARGE.nodes.map((n, i) => ({ ...n, name: `Unit-${i}` }));

describe("mountsFirst", () => {
  it(`mounts the first ${OUTLINE_FIRST_ROWS} rows, and a row with no place in the order`, () => {
    expect(mountsFirst(0, undefined)).toBe(true);
    expect(mountsFirst(OUTLINE_FIRST_ROWS - 1, undefined)).toBe(true);
    expect(mountsFirst(OUTLINE_FIRST_ROWS, undefined)).toBe(false);
    expect(mountsFirst(undefined, undefined)).toBe(true);
    expect(mountsFirst(undefined, 100)).toBe(true);
  });

  it("mounts the screen around the current row: a few rows before it, a screen's worth from it", () => {
    const current = 100;
    expect(mountsFirst(current, current)).toBe(true);
    expect(mountsFirst(current - OUTLINE_CURRENT_BEFORE, current)).toBe(true);
    expect(mountsFirst(current - OUTLINE_CURRENT_BEFORE - 1, current)).toBe(false);
    expect(mountsFirst(current + OUTLINE_FIRST_ROWS - 1, current)).toBe(true);
    expect(mountsFirst(current + OUTLINE_FIRST_ROWS, current)).toBe(false);
    // A current row inside the first screen adds nothing past it.
    expect(mountsFirst(OUTLINE_FIRST_ROWS + 5, 0)).toBe(false);
  });
});

/** Renders the outline outside act(): the first commit is synchronous, so what it mounted can be read before the transition. */
let root: Root | null = null;
let host: HTMLElement | null = null;
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedActEnv: boolean | undefined;

function renderFirstCommit(current: string | null) {
  savedActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const r = root;
  flushSync(() =>
    r.render(
      <MemoryRouter>
        <PlannerOutline
          graph={{ ...LARGE, nodes: NODES }}
          nodes={NODES}
          findings={undefined}
          level={5}
          labelOf={(key) => NODES.find((n) => n.key === key)?.name ?? "Group not listed"}
          connections={[]}
          noConnections="No connections."
          noGroups="No groups."
          current={current}
          onShowInGraph={() => {}}
        />
      </MemoryRouter>,
    ),
  );
}

afterEach(() => {
  if (root !== null) flushSync(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  actEnv.IS_REACT_ACT_ENVIRONMENT = savedActEnv;
});

const pending = () => [...document.querySelectorAll<HTMLElement>('[data-outline-row="pending"]')];
const rowSlots = () => [...document.querySelectorAll<HTMLElement>('[data-outline-row="group"], [data-outline-row="pending"]')];

describe("the outline's first render (virtualised)", () => {
  it(`mounts the first ${OUTLINE_FIRST_ROWS} rows at once and the other ${NODES.length - OUTLINE_FIRST_ROWS} one transition later`, async () => {
    renderFirstCommit(null);
    expect(outlineRows()).toHaveLength(OUTLINE_FIRST_ROWS);
    // The slots keep the order: the mounted rows come first, each later one waits as an empty row hidden from assistive tech.
    const slots = rowSlots();
    expect(slots.slice(0, OUTLINE_FIRST_ROWS).every((s) => s.dataset.outlineRow === "group")).toBe(true);
    expect(pending()).toHaveLength(NODES.length - OUTLINE_FIRST_ROWS);
    for (const p of pending()) {
      expect(p).toHaveAttribute("aria-hidden", "true");
      expect(p).toBeEmptyDOMElement();
    }
    await waitFor(() => expect(outlineRows()).toHaveLength(NODES.length));
    expect(pending()).toHaveLength(0);
  });

  it("mounts the current row (the graph's selection) and the screen around it first, and focuses it", async () => {
    const target = NODES[120]!;
    renderFirstCommit(target.key);
    const row = outlineRowOf(target.name);
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("aria-current", "true");
    expect(document.activeElement).toBe(row);
    expect(outlineRows().length).toBeGreaterThan(OUTLINE_FIRST_ROWS);
    await waitFor(() => expect(outlineRows()).toHaveLength(NODES.length));
    expect(document.activeElement).toBe(outlineRowOf(target.name));
  });

  it("moves the keyboard to a neighbour's row that is not mounted yet, once it is", async () => {
    renderFirstCommit(null);
    const shown = new Set(outlineRows().map((r) => r.firstElementChild?.querySelector(".font-semibold")?.textContent?.replace(/^\d+× /, "")));
    // A neighbour button in a mounted row whose row waits for the transition.
    const button = outlineRows()
      .flatMap((r) => [...r.querySelectorAll<HTMLButtonElement>("button")])
      .find((b) => /^Unit-\d+$/.test(b.textContent ?? "") && !shown.has(b.textContent ?? ""));
    expect(button).toBeDefined();
    const name = button!.textContent!;
    expect(outlineRowOf(name)).toBeNull();
    fireEvent.click(button!);
    await waitFor(() => expect(document.activeElement).toBe(outlineRowOf(name)));
  });
});

describe("every group row skips its layout off screen", () => {
  it("is outline-row-lazy, the content-visibility utility, and stays in the DOM", () => {
    renderOutline(NODES.slice(0, 3));
    const rows = outlineRows();
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toHaveClass("outline-row-lazy");
  });
});
