import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ProductionGraphSchema, type Bottleneck, type PlannerEdge, type PlannerNode, type PlannerTransport } from "@satisfactory-dash/shared";
import { productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import type { OutlineConnection } from "../planner/outlineModel";
import { PlannerOutline } from "../planner/PlannerOutline";

const BASE = ProductionGraphSchema.parse(productionGraphTwoSites.data);

interface OutlineOptions {
  edges?: PlannerEdge[];
  transports?: PlannerTransport[];
  findings?: readonly Bottleneck[];
  connections?: OutlineConnection[];
  current?: string | null;
  onShowInGraph?: (key: string) => void;
}

/**
 * The Planner outline (ADR-0062 Decision 3) alone, over a graph of `nodes` (and any `edges` or `transports`), for the tests
 * that read a group's words: what the old Groups table's cells said, its rows now say.
 */
export function renderOutline(nodes: PlannerNode[], options: OutlineOptions = {}) {
  const graph = { ...BASE, nodes, edges: options.edges ?? [], transports: options.transports ?? [] };
  return render(
    <MemoryRouter>
      <PlannerOutline
        graph={graph}
        nodes={nodes}
        findings={options.findings}
        level={5}
        labelOf={(key) => nodes.find((n) => n.key === key)?.name ?? "Group not listed"}
        connections={options.connections ?? []}
        noConnections="No connections."
        noGroups="No groups."
        current={options.current ?? null}
        onShowInGraph={options.onShowInGraph ?? (() => {})}
      />
    </MemoryRouter>,
  );
}

/** The outline's group rows, in order. */
export const outlineRows = () => [...document.querySelectorAll<HTMLElement>('[data-outline-row="group"]')];

/** A group's row by its sentence's subject, the building's name with or without its count ("Miner Mk.2", "2× Smelter"). */
export const outlineRowOf = (subject: string) =>
  outlineRows().find((r) => {
    const name = r.firstElementChild?.querySelector(".font-semibold")?.textContent ?? "";
    return name === subject || name.endsWith(`× ${subject}`);
  }) ?? null;
