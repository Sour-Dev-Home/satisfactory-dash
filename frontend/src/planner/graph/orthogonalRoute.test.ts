import { describe, expect, it } from "vitest";
import { segmentHitsRect } from "./edgeShapes";
import { orderTracks, routeOrthogonal, type Point, type RouteCard, type RouteInput } from "./orthogonalRoute";

const card = (key: string, x: number, y: number, width = 100, height = 60): RouteCard => ({ key, x, y, width, height });
const segs = (pts: readonly Point[]) => pts.slice(1).map((p, i) => [pts[i], p] as const);
const shrink = (c: RouteCard, by = 1) => ({ x: c.x + by, y: c.y + by, width: c.width - 2 * by, height: c.height - 2 * by });

// Three columns (centres 50, 200, 350); B sits in the middle column's top, so A -> C's dummy is parked below it.
const A = card("A", 0, 0);
const B = card("B", 150, 0);
const C = card("C", 300, 100);
const scene: RouteInput = {
  cards: [A, B, C],
  edges: [
    { from: "A", to: "B", waypoints: [] },
    { from: "A", to: "C", waypoints: [{ x: 200, y: 120 }] },
    { from: "B", to: "C", waypoints: [] },
  ],
  labels: [undefined, undefined, undefined],
};

describe("routeOrthogonal", () => {
  it("draws only horizontal and vertical segments, none through a card that is not an end", () => {
    const out = routeOrthogonal(scene);
    out.paths.forEach((path, i) => {
      const e = scene.edges[i];
      for (const [a, b] of segs(path)) {
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const c of out.cards) if (c.key !== e.from && c.key !== e.to) expect(segmentHitsRect(a, b, shrink(c))).toBe(false);
        // Not through its own cards either: only the end points touch them.
        for (const k of [e.from, e.to]) expect(segmentHitsRect(a, b, shrink(out.cards.find((c) => c.key === k)!))).toBe(false);
      }
    });
  });

  it("starts on the source card's right side and ends on the target card's left side, within the side", () => {
    const out = routeOrthogonal(scene);
    out.paths.forEach((path, i) => {
      const s = out.cards.find((c) => c.key === scene.edges[i].from)!;
      const t = out.cards.find((c) => c.key === scene.edges[i].to)!;
      const first = path[0];
      const last = path[path.length - 1];
      expect(first.x).toBe(s.x + s.width);
      expect(first.y).toBeGreaterThan(s.y);
      expect(first.y).toBeLessThan(s.y + s.height);
      expect(last.x).toBe(t.x);
      expect(last.y).toBeGreaterThan(t.y);
      expect(last.y).toBeLessThan(t.y + t.height);
    });
  });

  it("spreads several ends on one side evenly", () => {
    const out = routeOrthogonal(scene);
    // A has two ends on its right side: at a third and two thirds of its height.
    const ys = out.paths.slice(0, 2).map((p) => p[0].y).sort((a, b) => a - b);
    expect(ys).toEqual([20, 40]);
  });

  it("gives each vertical leg in a gap its own track, inside the gap", () => {
    const out = routeOrthogonal(scene);
    const verticals = out.paths.flatMap((p) => segs(p).filter(([a, b]) => a.x === b.x && a.y !== b.y).map(([a]) => a.x));
    const inGap0 = verticals.filter((x) => x > 100 && x < 150);
    expect(new Set(inGap0).size).toBe(inGap0.length);
    for (const x of verticals) expect(out.cards.some((c) => x > c.x && x < c.x + c.width)).toBe(false);
  });

  it("widens a gap whose tracks do not fit, keeping tracks at least the track room apart", () => {
    // Ten edges from a tall card to ten cards stacked in the next column, through a 50-wide gap.
    const tall = card("S", 0, 0, 100, 600);
    const targets = Array.from({ length: 10 }, (_, i) => card(`T${i}`, 150, i * 70 + 300, 100, 60));
    const out = routeOrthogonal({ cards: [tall, ...targets], edges: targets.map((t) => ({ from: "S", to: t.key, waypoints: [] })), labels: targets.map(() => undefined) }, { track: 8 });
    expect(out.widened).toBeGreaterThan(0);
    const xs = [...new Set(out.paths.flatMap((p) => segs(p).filter(([a, b]) => a.x === b.x && a.y !== b.y).map(([a]) => a.x)))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(8 - 1e-9);
    // The targets moved right with their column.
    expect(out.cards.find((c) => c.key === "T0")!.x).toBeGreaterThan(150);
  });

  it("keeps a straightened edge at its height across a column where that height is free", () => {
    // A -> C's dummy is parked low (y 200); C's centre is at y 130, and nothing else sits there in the middle column.
    const parked: RouteInput = { ...scene, edges: [{ from: "A", to: "C", waypoints: [{ x: 200, y: 200 }] }], labels: [undefined] };
    const plain = routeOrthogonal(parked);
    const straight = routeOrthogonal(parked, { straighten: true });
    const maxY = (p: readonly Point[]) => Math.max(...p.map((q) => q.y));
    expect(maxY(plain.paths[0])).toBe(200);
    expect(maxY(straight.paths[0])).toBeLessThan(200);
  });
});

describe("orderTracks", () => {
  it("puts the leg that starts higher right of a lower one going the same way, so they do not cross", () => {
    const a = { edge: 0, at: 0, yl: 0, yr: 100 };
    const b = { edge: 1, at: 0, yl: 50, yr: 150 };
    expect(orderTracks([a, b]).map((l) => l.edge)).toEqual([1, 0]);
  });
});
