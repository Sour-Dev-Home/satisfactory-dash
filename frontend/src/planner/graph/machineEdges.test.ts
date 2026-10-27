import { describe, expect, it } from "vitest";
import { MACHINES_MAX, groupMachines } from "./canvasScene";
import { motionPathAround, piecesOutside } from "./edgeShapes";
import { MACHINE_CARD_H, MACHINE_CARD_W, machineFrameSize, machineSlot, machineSlots } from "./layoutSite";

const box = { x: 40, y: -10, width: 20, height: 20 };
const finite = (pieces: readonly { x: number; y: number }[][]) => pieces.every((p) => p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));

describe("piecesOutside, odd routes", () => {
  it("cuts a vertical-only route through the box", () => {
    const pieces = piecesOutside([{ x: 50, y: -50 }, { x: 50, y: 50 }], box);
    expect(pieces).toEqual([
      [{ x: 50, y: -50 }, { x: 50, y: -10 }],
      [{ x: 50, y: 10 }, { x: 50, y: 50 }],
    ]);
  });

  it("starts the first piece at the box edge when the route begins inside the box", () => {
    expect(piecesOutside([{ x: 50, y: 0 }, { x: 100, y: 0 }], box)).toEqual([[{ x: 60, y: 0 }, { x: 100, y: 0 }]]);
  });

  it("leaves the box and re-enters it: three pieces, none inside", () => {
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 50, y: 40 }, { x: 50, y: 0 }, { x: 0, y: 0 }];
    const pieces = piecesOutside(route, box);
    expect(pieces.length).toBe(3);
    expect(finite(pieces)).toBe(true);
    for (const piece of pieces) for (const p of piece) expect(p.x > 40 + 1e-6 && p.x < 60 - 1e-6 && p.y > -10 + 1e-6 && p.y < 10 - 1e-6).toBe(false);
  });

  it("copes with empty, single-point, repeated-point and zero-size-box input without NaN", () => {
    expect(piecesOutside([], box)).toEqual([]);
    expect(piecesOutside([{ x: 1, y: 1 }], box)).toEqual([]);
    expect(piecesOutside([{ x: 0, y: 0 }, { x: 0, y: 0 }], box)).toEqual([]);
    expect(motionPathAround([], box, 5)).toBeNull();
    const flat = piecesOutside([{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 50, y: 0, width: 0, height: 0 });
    expect(finite(flat)).toBe(true);
    expect(flat.length).toBeGreaterThan(0);
    const d = motionPathAround([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }], box, 0);
    expect(d).not.toBeNull();
    expect(d).not.toMatch(/NaN/);
  });

  it("treats a route along the box edge as touching (the edge is in the box), covering the whole length either way", () => {
    const pieces = piecesOutside([{ x: 0, y: 10 }, { x: 100, y: 10 }], box);
    expect(finite(pieces)).toBe(true);
    expect(pieces[0][0]).toEqual({ x: 0, y: 10 });
    expect(pieces[pieces.length - 1].at(-1)).toEqual({ x: 100, y: 10 });
  });

  it("cuts a diagonal route and names no NaN", () => {
    const pieces = piecesOutside([{ x: 0, y: -20 }, { x: 100, y: 20 }], box);
    expect(finite(pieces)).toBe(true);
    expect(pieces.length).toBe(2);
  });
});

describe("the frame of an opened group", () => {
  it.each([0, 1, 2, 47, 48, 49, 1000])("sizes %i cards to a finite frame that holds every slot without overlap", (n) => {
    const f = machineFrameSize(n, 20);
    expect(Number.isFinite(f.width) && Number.isFinite(f.height)).toBe(true);
    const shown = Math.min(n, 49);
    const seen = new Set<string>();
    for (let i = 0; i < shown; i++) {
      const at = machineSlot(i, shown);
      expect(at.x + MACHINE_CARD_W).toBeLessThanOrEqual(f.width);
      expect(at.y + MACHINE_CARD_H).toBeLessThanOrEqual(f.height);
      seen.add(`${at.x},${at.y}`);
    }
    expect(seen.size).toBe(shown);
  });

  it("grows with the machine count, and the cap plus its +k card is 49 slots", () => {
    expect(machineFrameSize(49, 5).height).toBeGreaterThanOrEqual(machineFrameSize(2, 5).height);
    expect(machineSlots({ ids: Array.from({ length: MACHINES_MAX }, (_, i) => String(i)), more: 3 })).toBe(MACHINES_MAX + 1);
  });

  it("widens for a long title", () => {
    expect(machineFrameSize(2, 200).width).toBeGreaterThan(machineFrameSize(2, 5).width);
  });
});

describe("groupMachines, odd ids", () => {
  it("counts the machines it has no id for as more, and drops duplicate ids", () => {
    expect(groupMachines({ count: 8, machineIds: ["a", "a", "b"] }, false)).toEqual({ open: false, ids: ["a", "b"], more: 6 });
  });

  it("is absent with no ids, one machine, or a zero or NaN count", () => {
    expect(groupMachines({ count: 8, machineIds: [] }, false)).toBeUndefined();
    expect(groupMachines({ count: 1, machineIds: ["a"] }, false)).toBeUndefined();
    expect(groupMachines({ count: Number.NaN, machineIds: ["a", "b"] }, false)).toBeUndefined();
  });

  it("never reports a negative more when the ids outnumber the count", () => {
    expect(groupMachines({ count: 2, machineIds: ["a", "b", "c"] }, true)?.more).toBe(0);
  });
});
