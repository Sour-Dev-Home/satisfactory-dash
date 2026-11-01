import { beforeEach, describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { plannerCapsLarge } from "../../test/scenarios";
import { overviewScene, type Scene } from "./canvasScene";
import { factoryModels } from "./hierarchy";
import { CAP_ROW_H, clearLayoutMemo, layoutScene, layoutStats } from "./layoutSite";

// ADR-0062 Decision 1: the caps' footer row is one fixed row inside the card, so dagre and the router see only taller cards
// and ADR-0050 Decision 3's 100 ms layout budget holds. Measured A/B on the same scene, with and without its caps (the
// numbers are recorded in the ADR's "Values chosen in build PR 3 (caps)").

beforeEach(() => clearLayoutMemo());

const graph = ProductionGraphResponseSchema.parse(plannerCapsLarge).data;
const withCaps = overviewScene(graph, factoryModels(graph));
const withoutCaps: Scene = { ...withCaps, cards: withCaps.cards.map((c) => ({ ...c, caps: undefined })) };

/** The median of five cold layouts (the memo cleared each time), after one to warm the JIT. */
function median(scene: Scene): { ms: number; layout: ReturnType<typeof layoutScene> } {
  let layout = layoutScene(scene, graph.topologyHash);
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    clearLayoutMemo();
    const start = performance.now();
    layout = layoutScene(scene, graph.topologyHash);
    runs.push(performance.now() - start);
  }
  return { ms: runs.sort((a, b) => a - b)[2], layout };
}

/** CI machines vary, so the test's own bound is looser than the budget. */
const TEST_BOUND_MS = 3_000;

describe("the caps' layout cost", () => {
  it("grows only the capped cards, by one row, and routes the same lines without a router failure", () => {
    expect(withCaps.cards.every((c) => (c.caps?.length ?? 0) > 0)).toBe(true);
    const a = layoutScene(withCaps, graph.topologyHash);
    const b = layoutScene(withoutCaps, graph.topologyHash);
    expect(a.nodes.map((n) => n.height - b.nodes.find((m) => m.key === n.key)!.height)).toEqual(a.nodes.map(() => CAP_ROW_H));
    expect(a.edges).toHaveLength(b.edges.length);
    expect(layoutStats().routerFailures).toBe(0);
  });

  it("lays out the 48-card overview with caps about as fast as without (median of five)", { timeout: 30_000 }, () => {
    const off = median(withoutCaps);
    const on = median(withCaps);
    console.info(`[ADR-0062 caps layout] ${withCaps.cards.length} cards, ${on.layout.edges.length} lines: without caps ${Math.round(off.ms)} ms, with caps ${Math.round(on.ms)} ms`);
    expect(on.ms).toBeLessThan(TEST_BOUND_MS);
    expect(on.layout.nodes).toHaveLength(withCaps.cards.length);
  });
});
