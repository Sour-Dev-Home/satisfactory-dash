import { describe, expect, it } from "vitest";
import type { CanvasFlow } from "./canvasScene";
import { glyphCandidates, movingGlyphs } from "./glyphMotion";
import { lineStroke, TRANSPORT_GAP, TRANSPORT_W } from "./lineWidth";
import { GLYPH_MAX_S, GLYPH_MIN_S } from "./marching";

const flow = (over: Partial<CanvasFlow> = {}): CanvasFlow =>
  ({ from: "a", to: "b", carrier: "truck", flow: "supply", mixed: false, rate: "measured", ratePerMinute: 200, unit: "items/min", ...over }) as CanvasFlow;
const edge = (index: number, over: Partial<CanvasFlow> = {}, x = 0, length = 400) => ({
  index,
  flow: flow(over),
  points: [{ x, y: 500 }, { x: x + length, y: 500 }],
  length,
  labelX: x + length / 2,
  labelY: 500,
  labelWidth: 40,
  labelHeight: 20,
});
const STAGE = { width: 1000, height: 600 };
const HOME = { x: 0, y: 0, k: 1 };

describe("glyphCandidates hunt", () => {
  it("skips belts and pipes, and a route lying wholly in its own label box (it stays at rest)", () => {
    const tiny = { ...edge(2), points: [{ x: 195, y: 500 }, { x: 205, y: 500 }], length: 10, labelX: 200 };
    const out = glyphCandidates([edge(0, { carrier: "belt" }), edge(1, { carrier: "pipe" }), tiny, edge(3, { carrier: "depot" })], true);
    expect(out.map((c) => c.edge.index)).toEqual([3]);
  });

  it("drops a stalled transport only in marks mode", () => {
    const stalled = edge(0, { stalled: "backedUp" } as Partial<CanvasFlow>);
    expect(glyphCandidates([stalled], true)).toHaveLength(0);
    expect(glyphCandidates([stalled], false)).toHaveLength(1);
  });

  it("clamps a trip's seconds between GLYPH_MIN_S and GLYPH_MAX_S", () => {
    const [short, long] = glyphCandidates([edge(0, {}, 0, 100), edge(1, {}, 0, 5000)], true);
    expect(short.seconds).toBe(GLYPH_MIN_S);
    expect(long.seconds).toBe(GLYPH_MAX_S);
  });

  it("ignores an edge with fewer than two points", () => {
    expect(glyphCandidates([{ ...edge(0), points: [{ x: 1, y: 1 }] }], true)).toEqual([]);
  });
});

describe("movingGlyphs hunt", () => {
  const many = glyphCandidates(Array.from({ length: 6 }, (_, i) => edge(i, {}, i * 10)), true);

  it("keeps edge order and stops at the cap, with out-of-view routes not using it up", () => {
    const far = glyphCandidates([edge(0, {}, 5000), ...Array.from({ length: 3 }, (_, i) => edge(i + 1, {}, 10 * i))], true);
    expect(movingGlyphs(far, HOME, STAGE, 2).map((c) => c.edge.index)).toEqual([1, 2]);
    expect(movingGlyphs(many, HOME, STAGE, 0)).toEqual([]);
  });

  it("follows the view: panned away, nothing moves", () => {
    expect(movingGlyphs(many, { x: -5000, y: 0, k: 1 }, STAGE)).toEqual([]);
    expect(movingGlyphs(many, HOME, STAGE)).toHaveLength(6);
  });
});

describe("lineStroke transports hunt", () => {
  it("gives every non-belt carrier the same double stroke, mixed or unknown rate alike, and a belt never", () => {
    for (const carrier of ["train", "truck", "drone", "depot"]) {
      for (const over of [{}, { mixed: true }, { ratePerMinute: null }]) {
        expect(lineStroke(flow({ carrier, ...over } as Partial<CanvasFlow>)), `${carrier} ${JSON.stringify(over)}`).toEqual({ width: TRANSPORT_W, inner: TRANSPORT_GAP, double: true });
      }
    }
    expect(lineStroke(flow({ carrier: "belt" })).double).toBe(false);
    expect(lineStroke(flow({ carrier: "pipe", mixed: true })).double).toBe(false);
  });
});
