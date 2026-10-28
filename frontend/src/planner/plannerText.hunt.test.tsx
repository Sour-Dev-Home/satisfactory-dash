import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type Bottleneck, type ProductionGraphResponse } from "@satisfactory-dash/shared";
import { bottlenecksBeltLevel, productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import * as world from "../demo/world";
import { PlannerPanel } from "./PlannerPanel";
import { edgeCapacityText, edgeRateText, findingsFor, siteFindings, stateCountsText } from "./plannerText";

const base = bottlenecksBeltLevel.data.findings[0] as Bottleneck;
const finding = (buildingId: string, affected: string[] = []): Bottleneck => ({
  ...base,
  buildingId,
  affectedCount: Math.max(1, affected.length),
  affected: affected.map((id) => ({ buildingId: id, buildingName: "Constructor", recipe: null })),
});

describe("edgeRateText: wording", () => {
  it("never says 'about' for measured, including zero and tiny rates", () => {
    for (const r of [0, 0.04, 1, 999.96, 1234.56]) {
      const text = edgeRateText({ kind: "belt", rate: "measured", ratePerMinute: r });
      expect(text).not.toMatch(/about/i);
      expect(text).toMatch(/items\/min$/);
    }
    expect(edgeRateText({ kind: "belt", rate: "measured", ratePerMinute: 0 })).toBe("0 items/min");
  });
  it("estimated zero still says 'about'; pipes say m3/min", () => {
    expect(edgeRateText({ kind: "belt", rate: "estimated", ratePerMinute: 0 })).toBe("about 0 items/min");
    expect(edgeRateText({ kind: "pipe", rate: "measured", ratePerMinute: 30 })).toBe("30 m³/min");
    expect(edgeRateText({ kind: "pipe", rate: "estimated", ratePerMinute: 7.25 })).toMatch(/^about 7\.\d m³\/min$/);
  });
  it("unknown, or a null rate under any word, shows no number", () => {
    for (const rate of ["unknown", "measured", "estimated"] as const) {
      const text = edgeRateText({ kind: "belt", rate, ratePerMinute: null });
      expect(text).toBe("unknown");
    }
    expect(edgeRateText({ kind: "pipe", rate: "unknown", ratePerMinute: 55 })).toBe("unknown");
  });
  it("capacity: null is null, zero is a number", () => {
    expect(edgeCapacityText({ kind: "belt", capacityPerMinute: null })).toBeNull();
    expect(edgeCapacityText({ kind: "belt", capacityPerMinute: 0 })).toBe("0 items/min");
  });
});

describe("stateCountsText", () => {
  it("handles all-zero counts and prototype-named states as text", () => {
    expect(stateCountsText({ producing: 0 })).toBe("No machine states");
    expect(stateCountsText({})).toBe("No machine states");
    expect(stateCountsText({ constructor: 2, toString: 1 })).toBe("2 constructor, 1 toString");
  });
});

describe("the bottleneck join", () => {
  it("matches by representative id or by an affected machine", () => {
    expect(findingsFor(["a"], [finding("a")])).toHaveLength(1);
    expect(findingsFor(["b"], [finding("a", ["a", "b"])])).toHaveLength(1);
    expect(findingsFor(["z"], [finding("a", ["a", "b"])])).toHaveLength(0);
  });
  it("counts a finding once when both its representative and affected machines are in the set", () => {
    expect(findingsFor(["a", "b", "c"], [finding("a", ["a", "b", "c"])])).toHaveLength(1);
  });
  it("counts a finding once across nodes", () => {
    const nodes = [
      { ...productionGraphTwoSites.data.nodes[0], machineIds: ["a"] },
      { ...productionGraphTwoSites.data.nodes[1], machineIds: ["b"] },
    ];
    expect(siteFindings(nodes as never, [finding("a", ["a", "b"])])).toHaveLength(1);
  });
  it("ignores a finding for a machine in no node; empty and undefined inputs give none", () => {
    expect(findingsFor(["a"], [finding("ghost")])).toEqual([]);
    expect(findingsFor([], [finding("a")])).toEqual([]);
    expect(findingsFor(["a"], [])).toEqual([]);
    expect(findingsFor(["a"], undefined)).toEqual([]);
  });
});

const renderPanel = (snapshot: ProductionGraphResponse, props: Partial<Parameters<typeof PlannerPanel>[0]> = {}) =>
  render(
    <MemoryRouter>
      <PlannerPanel snapshot={snapshot} path={[]} onPath={() => {}} {...props} />
    </MemoryRouter>,
  );
const parsed = ProductionGraphResponseSchema.parse(productionGraphTwoSites);

describe("PlannerPanel", () => {
  it("falls back to the overview when the selected site is gone after a refetch", () => {
    renderPanel(parsed, { path: ["site-that-vanished"] });
    expect(screen.getByRole("list", { name: "Sites" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All sites" })).not.toBeInTheDocument();
  });
  it("says the truncation note, and also without any findings read", () => {
    renderPanel(parsed, { findings: [], findingsTruncated: true });
    expect(screen.getByRole("list", { name: "Planner notes" })).toHaveTextContent("top findings only");
  });
  it("no sites and beltData present vs. absent give different words", () => {
    const empty = { ...parsed, data: { ...parsed.data, sites: [], nodes: [], edges: [] } };
    const { unmount } = renderPanel(empty);
    expect(screen.getByText(/No sites yet/)).toBeInTheDocument();
    unmount();
    renderPanel({ ...empty, data: { ...empty.data, beltData: "tooLarge" } });
    expect(screen.getByText(/needs belt data/)).toBeInTheDocument();
  });
  it("renders hostile site names, outputs and notes as text", () => {
    const evil = '<script>window.__x=1</script><b>x</b>';
    const sites = parsed.data.sites.map((s, i) => (i === 0 ? { ...s, name: evil, topOutputs: s.topOutputs.map((o) => ({ ...o, name: evil })) } : s));
    const { container } = renderPanel({
      ...parsed,
      data: { ...parsed.data, sites, notes: [{ code: "connectionsRefresh", text: evil }] },
    });
    expect(container.querySelector("script, b")).toBeNull();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(0);
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });
  it("a site whose nodeKeys name no node shows no bottleneck from stray findings", () => {
    const sites = parsed.data.sites.map((s) => ({ ...s, nodeKeys: ["nope"] }));
    renderPanel({ ...parsed, data: { ...parsed.data, sites } }, { findings: [finding("ghost")] });
    const first = screen.getAllByRole("listitem").find((li) => within(li).queryByRole("button")) as HTMLElement;
    expect(first).toHaveTextContent("No bottlenecks");
  });
});

describe("the demo world's planner", () => {
  it("parses and its machine ids join the demo bottlenecks and cover the factory", () => {
    const now = world.DEMO_EPOCH;
    const g = ProductionGraphResponseSchema.parse(world.productionGraph(now)).data;
    const ids = g.nodes.flatMap((n) => n.machineIds);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = new Set(g.nodes.map((n) => n.key));
    for (const e of g.edges) expect(keys.has(e.from) && keys.has(e.to)).toBe(true);
    for (const s of g.sites) {
      expect(s.nodeKeys.every((k) => keys.has(k))).toBe(true);
      const sum = g.nodes.filter((n) => s.nodeKeys.includes(n.key)).reduce((t, n) => t + n.count, 0);
      expect(s.machineCount).toBe(sum);
    }
    for (const n of g.nodes) expect(n.machineIds.length === 0 || n.machineIds.length === n.count).toBe(true);
    const found = world.bottlenecks(now).data.findings;
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(findingsFor(ids, [f])).toHaveLength(1);
    for (const e of g.edges) {
      if (e.rate === "unknown") expect(edgeRateText(e)).toBe("unknown");
      if (e.rate === "measured") expect(edgeRateText(e)).not.toMatch(/about/);
    }
  });
});
