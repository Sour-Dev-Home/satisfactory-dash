import { waitFor } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type PlannerNode } from "@satisfactory-dash/shared";
import { outlineRowOf, outlineRows } from "../test/outline";
import { plannerLarge } from "../test/scenarios";
import { PlannerOutline } from "./PlannerOutline";

const LARGE = ProductionGraphResponseSchema.parse(plannerLarge).data;
const NODES: PlannerNode[] = LARGE.nodes.map((n, i) => ({ ...n, name: `Unit-${i}` }));

let root: Root | null = null;
let host: HTMLElement | null = null;
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedActEnv: boolean | undefined;

function show(current: string | null) {
  const r = root!;
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

function start() {
  savedActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
}

afterEach(() => {
  if (root !== null) flushSync(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  actEnv.IS_REACT_ACT_ENVIRONMENT = savedActEnv;
});

describe("the virtualised outline when the current row changes before the transition lands", () => {
  it("never turns a mounted row back into an empty placeholder (monotonic once mounted)", async () => {
    start();
    show(NODES[120]!.key);
    const row = outlineRowOf("Unit-120");
    expect(row).not.toBeNull();
    // The graph's selection moves before the transition lands.
    show(NODES[0]!.key);
    expect(outlineRowOf("Unit-120")).toBe(row);
    await waitFor(() => expect(outlineRows()).toHaveLength(NODES.length));
  });

  it("marks a new current row that was still pending as aria-current once it settles", async () => {
    start();
    show(null);
    show(NODES[150]!.key);
    await waitFor(() => expect(outlineRowOf("Unit-150")).toHaveAttribute("aria-current", "true"));
    expect(outlineRows().filter((r) => r.getAttribute("aria-current") === "true")).toHaveLength(1);
  });
});
