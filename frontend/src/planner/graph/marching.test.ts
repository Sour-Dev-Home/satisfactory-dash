import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CanvasFlow } from "./canvasScene";
import { CARD_STACK_OFFSET, MARCH_MAX, PULSE_DASH, marchCandidates, marchHoles, marchStep, marchingLines, routeBox } from "./marching";
import type { Stage, View } from "./viewport";

// ADR-0062 amendment build PR 3: which lines march, at which step, and which of them the in-view cap keeps.

const flow = (over: Partial<CanvasFlow> = {}): CanvasFlow => ({
  from: "a",
  to: "b",
  itemClassName: "Desc_IronPlate_C",
  itemName: "Iron Plate",
  carrier: "belt",
  flow: "supply",
  mixed: false,
  rate: "measured",
  label: "",
  labelLines: [],
  ratePerMinute: 200,
  unit: "items/min",
  quality: "measured",
  ...over,
});

describe("marchStep", () => {
  it("moves a measured or estimated belt or pipe at its rate's step", () => {
    expect(marchStep(flow({ ratePerMinute: 30 }))).toBe("slow");
    expect(marchStep(flow({ ratePerMinute: 200 }))).toBe("mid");
    expect(marchStep(flow({ ratePerMinute: 480 }))).toBe("fast");
    expect(marchStep(flow({ rate: "estimated", ratePerMinute: 102.2 }))).toBe("slow");
    expect(marchStep(flow({ carrier: "pipe", unit: "m3/min", ratePerMinute: 700 }))).toBe("fast");
  });

  it("counts an 'at least' rate as estimated: it moves at its step", () => {
    expect(marchStep(flow({ rate: "estimated", quality: "atLeast", ratePerMinute: 300 }))).toBe("mid");
  });

  it("keeps an unknown rate, a stalled line, a transport and a rate of no step still", () => {
    expect(marchStep(flow({ rate: "unknown", ratePerMinute: null }))).toBeNull();
    // Even an unknown line that somehow carries a number: unknown is static and dotted.
    expect(marchStep(flow({ rate: "unknown", ratePerMinute: 200 }))).toBeNull();
    expect(marchStep(flow({ stalled: "backedUp" }))).toBeNull();
    expect(marchStep(flow({ rate: "estimated", stalled: "underfed", ratePerMinute: 50 }))).toBeNull();
    for (const carrier of ["train", "truck", "drone", "depot"]) expect(marchStep(flow({ carrier }))).toBeNull();
    expect(marchStep(flow({ ratePerMinute: 0 }))).toBeNull();
    expect(marchStep(flow({ ratePerMinute: null }))).toBeNull();
  });
});

describe("routeBox", () => {
  it("bounds a route's points, and is empty for none", () => {
    expect(routeBox([{ x: 10, y: 5 }, { x: 40, y: 5 }, { x: 40, y: -20 }])).toEqual({ x: 10, y: -20, width: 30, height: 25 });
    expect(routeBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

const STAGE: Stage = { width: 1000, height: 600 };
const AT_REST: View = { x: 0, y: 0, k: 1 };
/** A horizontal line at (x, y), 100 long. */
const edge = (index: number, x: number, y: number, over: Partial<CanvasFlow> = {}) => ({
  index,
  flow: flow(over),
  points: [
    { x, y },
    { x: x + 100, y },
  ],
});

describe("marchCandidates", () => {
  it("lists only the lines that can march, fastest step first, then the layout's order", () => {
    const edges = [
      edge(0, 0, 10, { ratePerMinute: 30 }),
      edge(1, 0, 20, { ratePerMinute: 600 }),
      edge(2, 0, 30, { rate: "unknown", ratePerMinute: null }),
      edge(3, 0, 40, { ratePerMinute: 200 }),
      edge(4, 0, 50, { ratePerMinute: 900 }),
      edge(5, 0, 60, { carrier: "train" }),
      { index: 6, flow: flow(), points: [{ x: 0, y: 0 }] },
    ];
    expect(marchCandidates(edges).map((c) => [c.index, c.step])).toEqual([
      [1, "fast"],
      [4, "fast"],
      [3, "mid"],
      [0, "slow"],
    ]);
  });
});

describe("marchingLines", () => {
  it("marches only the lines whose route meets the stage", () => {
    const candidates = marchCandidates([edge(0, 100, 100), edge(1, 1200, 100), edge(2, 100, 700), edge(3, -150, 300)]);
    expect([...marchingLines(candidates, AT_REST, STAGE).keys()]).toEqual([0]);
  });

  it("follows the view: a pan brings other lines in and takes these out", () => {
    const candidates = marchCandidates([edge(0, 100, 100), edge(1, 1200, 100)]);
    const panned: View = { x: -1000, y: 0, k: 1 };
    expect([...marchingLines(candidates, panned, STAGE).keys()]).toEqual([1]);
    // Zoomed out, both are in view.
    expect([...marchingLines(candidates, { x: 0, y: 0, k: 0.5 }, STAGE).keys()].sort()).toEqual([0, 1]);
  });

  it("stops at the cap, keeping the fastest lines and then the layout's order", () => {
    const edges = Array.from({ length: MARCH_MAX + 20 }, (_, i) => edge(i, 10, 10 + (i % 50) * 10, { ratePerMinute: i % 3 === 0 ? 600 : 30 }));
    const lines = marchingLines(marchCandidates(edges), AT_REST, STAGE);
    expect(lines.size).toBe(MARCH_MAX);
    const fast = edges.filter((e) => e.flow.ratePerMinute === 600).map((e) => e.index);
    // Every fast line (27 of them) is kept; the rest of the cap is the first slow lines in order.
    for (const i of fast) expect(lines.get(i)).toBe("fast");
    const slowKept = [...lines.entries()].filter(([, s]) => s === "slow").map(([i]) => i);
    const slowAll = edges.filter((e) => e.flow.ratePerMinute === 30).map((e) => e.index);
    expect(slowKept).toEqual(slowAll.slice(0, MARCH_MAX - fast.length));
    // A smaller cap keeps a prefix of the same order: the choice is deterministic.
    expect([...marchingLines(marchCandidates(edges), AT_REST, STAGE, 5).keys()]).toEqual(fast.slice(0, 5));
  });

  it("marches nothing with a cap of 0 or no candidates", () => {
    expect(marchingLines(marchCandidates([edge(0, 10, 10)]), AT_REST, STAGE, 0).size).toBe(0);
    expect(marchingLines([], AT_REST, STAGE).size).toBe(0);
  });
});

describe("marchHoles", () => {
  const node = (kind: string, x = 0) => ({ x, y: 10, width: 100, height: 40, card: { kind } });
  const label = { labelX: 50, labelY: 20, labelWidth: 60, labelHeight: 24 };

  it("cuts every label pill, centred on its label and rounded like it, and every card", () => {
    expect(marchHoles([node("group")], [label])).toEqual([
      { x: 20, y: 8, width: 60, height: 24, rx: 12 },
      { x: 0, y: 10, width: 100, height: 40, rx: 8 },
    ]);
  });

  it("also cuts the pile behind a bubble's or a fold's card", () => {
    for (const kind of ["bubble", "fold"]) {
      expect(marchHoles([node(kind, 200)], [])).toEqual([
        { x: 200, y: 10, width: 100, height: 40, rx: 8 },
        { x: 200 + CARD_STACK_OFFSET, y: 10 + CARD_STACK_OFFSET, width: 100, height: 40, rx: 8 },
      ]);
    }
  });

  it("has no holes for an empty layout", () => {
    expect(marchHoles([], [])).toEqual([]);
  });
});

describe("the marching CSS (index.css)", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  const token = (name: string) => {
    const m = new RegExp(`--${name}:\\s*(-?[\\d.]+)px;`).exec(css);
    if (m === null) throw new Error(`--${name} is not a px token in src/index.css`);
    return Number(m[1]);
  };
  const cycle = (dash: string) => dash.split(" ").reduce((sum, n) => sum + Number(n), 0);

  it("shifts one dash cycle per animation cycle: the pulses' and the estimated dash's (8 5) and its inner (7 6) length", () => {
    expect(cycle(PULSE_DASH)).toBe(token("flow-dash-cycle"));
    expect(cycle("8 5")).toBe(token("flow-dash-cycle"));
    expect(cycle("7 6")).toBe(token("flow-dash-cycle"));
    expect(token("flow-dash-inner-offset")).toBe(-0.5);
  });

  it("times each step by its flow token, and hides a measured line's pulses unless they run", () => {
    for (const step of ["slow", "mid", "fast"]) {
      expect(css).toContain(`--animate-flow-${step}: flow-march var(--duration-flow-${step}) linear infinite;`);
      expect(css).toContain(`--animate-flow-inner-${step}: flow-march-inner var(--duration-flow-${step}) linear infinite;`);
      expect(css).toContain(`--animate-flow-pulse-${step}: flow-pulse var(--duration-flow-${step}) linear infinite;`);
    }
    const pulse = /@keyframes flow-pulse \{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? "";
    expect(pulse.match(/opacity: var\(--opacity-flow-pulse\)/g)).toHaveLength(2);
  });

  it("under reduced motion zeroes the flow tokens and stops every marching line outright", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? "";
    for (const step of ["slow", "mid", "fast"]) expect(reduced).toContain(`--duration-flow-${step}: 0s;`);
    expect(reduced).toMatch(/\[data-march\] \{\s*animation: none !important;\s*\}/);
  });
});
