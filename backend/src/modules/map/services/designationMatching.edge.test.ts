import { describe, expect, it } from "vitest";
import { findOverlap, matchDesignations } from "./designationMatching.js";
import type { DesignationBuilding, MatchableDesignation } from "./designationMatching.js";

// Edge cases written against the contract comment in packages/shared/src/plannerDesignations.ts.
const member = (id: string | null, c: string, x: number, y: number) => ({ id, c, x, y });
const building = (id: string, c: string, x: number, y: number): DesignationBuilding => ({ id, c, x, y });
const designation = (id: string, name: string, members: MatchableDesignation["members"]): MatchableDesignation => ({ id, name, members });

describe("matchDesignations edges", () => {
  it("matches at exactly 2 m and not at 2.001 m", () => {
    const d = designation("d", "D", [member(null, "S", 0, 0)]);
    expect(matchDesignations([d], [building("a", "S", 2, 0)])[0]?.matched).toBe(1);
    expect(matchDesignations([d], [building("a", "S", 0, -2)])[0]?.matched).toBe(1);
    expect(matchDesignations([d], [building("a", "S", 2.001, 0)])[0]?.matched).toBe(0);
  });

  it("works across the zero line and with negative coordinates", () => {
    const d = designation("d", "D", [member(null, "S", -3, -3), member(null, "S", 1, 1)]);
    const [m] = matchDesignations([d], [building("a", "S", -4.5, -3), building("b", "S", -0.5, 0.5), building("c", "S", -5.1, -3)]);
    expect(m?.buildingIds).toEqual(["a", "b"]);
  });

  it("picks the lowest id among equidistant buildings whatever the input order", () => {
    const d = designation("d", "D", [member(null, "S", 0, 0)]);
    const bs = [building("m", "S", 1, 0), building("k", "S", -1, 0), building("z", "S", 0, 1)];
    expect(matchDesignations([d], bs)[0]?.buildingIds).toEqual(["k"]);
    expect(matchDesignations([d], [...bs].reverse())[0]?.buildingIds).toEqual(["k"]);
  });

  it("duplicate members at one position match one building and leave the other missing", () => {
    const d = designation("d", "D", [member(null, "S", 5, 5), member(null, "S", 5, 5)]);
    const [m] = matchDesignations([d], [building("a", "S", 5, 5)]);
    expect([m?.matched, m?.missing]).toEqual([1, 1]);
  });

  it("an empty snapshot and a missing one both leave every member missing", () => {
    const d = designation("d", "D", [member("a", "S", 1, 1), member(null, "S", 2, 2)]);
    for (const snapshot of [null, []]) {
      const [m] = matchDesignations([d], snapshot);
      expect([m?.matched, m?.missing, m?.claimedBy]).toEqual([0, 2, undefined]);
    }
  });

  it("an id on another class is stale: the member falls through to the position passes", () => {
    const d = designation("d", "D", [member("b1", "OldClass", 0, 0)]);
    expect(matchDesignations([d], [building("b1", "NewClass", 500, 500)])[0]?.matched).toBe(0);
    const [m] = matchDesignations([d], [building("b1", "NewClass", 500, 500), building("n", "OldClass", 1, 0)]);
    expect(m?.buildingIds).toEqual(["n"]);
  });

  it("a lost member takes the next free building of the class within 2 m", () => {
    const older = designation("old", "Older", [member("b1", "S", 0, 0)]);
    const newer = designation("new", "Newer", [member(null, "S", 0, 0)]);
    const [a, b] = matchDesignations([older, newer], [building("b1", "S", 0, 0), building("b2", "S", 1.5, 0)]);
    expect(a?.buildingIds).toEqual(["b1"]);
    expect([b?.buildingIds, b?.missing, b?.claimedBy]).toEqual([["b2"], 0, undefined]);
  });

  it("with the next building beyond 2 m the member is missing and claimed", () => {
    const older = designation("old", "Older", [member("b1", "S", 0, 0)]);
    const newer = designation("new", "Newer", [member(null, "S", 0, 0)]);
    const [, b] = matchDesignations([older, newer], [building("b1", "S", 0, 0), building("b2", "S", 2.5, 0)]);
    expect([b?.matched, b?.missing, b?.claimedBy]).toEqual([0, 1, { id: "old", name: "Older", count: 1 }]);
  });

  it("ids are matched for every designation before positions: a younger id beats an older fuzzy match", () => {
    const older = designation("old", "Older", [member(null, "S", 0, 0)]);
    const younger = designation("new", "Newer", [member("b1", "S", 0, 0)]);
    const [a, b] = matchDesignations([older, younger], [building("b1", "S", 0, 0), building("b2", "S", 1, 0)]);
    expect(b?.buildingIds).toEqual(["b1"]);
    expect(a?.buildingIds).toEqual(["b2"]);
  });

  it("exact positions are taken before nearest ones, whatever the member order", () => {
    const members = [member(null, "S", 0, 0), member(null, "S", 1, 0)];
    const bs = [building("a", "S", 0.5, 0), building("b", "S", 1, 0)];
    for (const order of [members, [...members].reverse()]) {
      const [m] = matchDesignations([designation("d", "D", order)], bs);
      expect([...(m?.buildingIds ?? [])].sort()).toEqual(["a", "b"]);
      expect(m?.buildingIds).toHaveLength(2);
    }
  });

  it("shuffling the members changes nothing in matched, missing or the building set", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 40; round++) {
      const bs = Array.from({ length: 12 }, (_, i) => building(`b${i}`, rnd(2) ? "A" : "B", rnd(8), rnd(8)));
      const mk = (i: number) =>
        designation(`d${i}`, `D${i}`, Array.from({ length: 6 }, () => member(rnd(4) === 0 ? `b${rnd(12)}` : null, rnd(2) ? "A" : "B", rnd(8), rnd(8))));
      const base = [mk(0), mk(1)];
      const flipped = base.map((d) => ({ ...d, members: [...d.members].reverse() }));
      const a = matchDesignations(base, bs);
      const b = matchDesignations(flipped, bs);
      a.forEach((r, i) => {
        expect([r.matched, r.missing, r.claimedBy]).toEqual([b[i]?.matched, b[i]?.missing, b[i]?.claimedBy]);
        expect([...r.buildingIds].sort()).toEqual([...(b[i]?.buildingIds ?? [])].sort());
      });
    }
  });

  it("an id that no longer exists falls back to position, but only for the same class", () => {
    const d = designation("d", "D", [member("gone", "S", 0, 0), member("gone2", "S", 30, 30)]);
    const [m] = matchDesignations([d], [building("n1", "S", 1, 0), building("n2", "Other", 30, 30)]);
    expect(m?.buildingIds).toEqual(["n1"]);
  });

  it("a newer designation whose fuzzy member lands on the older one's building reports claimedBy and keeps nothing", () => {
    const older = designation("old", "Older", [member("b1", "S", 0, 0)]);
    const newer = designation("new", "Newer", [member(null, "S", 1, 0)]);
    const [a, b] = matchDesignations([older, newer], [building("b1", "S", 0, 0)]);
    expect(a?.claimedBy).toBeUndefined();
    expect([b?.matched, b?.missing, b?.claimedBy]).toEqual([0, 1, { id: "old", name: "Older", count: 1 }]);
  });

  it("claimedBy names the older designation that took the most of this one's buildings", () => {
    const d1 = designation("d1", "One", [member("a", "S", 0, 0)]);
    const d2 = designation("d2", "Two", [member("b", "S", 10, 10), member("c", "S", 20, 20)]);
    const d3 = designation("d3", "Three", [member("a", "S", 0, 0), member("b", "S", 10, 10), member("c", "S", 20, 20)]);
    const bs = [building("a", "S", 0, 0), building("b", "S", 10, 10), building("c", "S", 20, 20)];
    const result = matchDesignations([d1, d2, d3], bs);
    expect(result[2]?.claimedBy).toEqual({ id: "d2", name: "Two", count: 2 });
    expect([result[2]?.matched, result[2]?.missing]).toEqual([0, 3]);
  });

  it("buildings with non-finite coordinates never match", () => {
    const d = designation("d", "D", [member(null, "S", 0, 0)]);
    const bs = [building("n", "S", Number.NaN, 0), building("i", "S", Number.POSITIVE_INFINITY, 0)];
    expect(matchDesignations([d], bs)[0]?.matched).toBe(0);
  });

  it("hostile ids and classes cannot reach the prototype", () => {
    const d = designation("__proto__", "D", [member("__proto__", "constructor", 0, 0), member("toString", "S", 0, 0)]);
    const [m] = matchDesignations([d], [building("hasOwnProperty", "constructor", 0, 0)]);
    expect([m?.matched, m?.missing]).toEqual([1, 1]);
  });

  it("invariants hold on pseudo-random data: matched+missing = members, no building held twice, older holds first", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 50; round++) {
      const classes = ["A", "B"];
      const bs = Array.from({ length: 30 }, (_, i) => building(`b${i}`, classes[rnd(2)] ?? "A", rnd(20) - 10 + rnd(10) / 10, rnd(20) - 10));
      const ds = Array.from({ length: 4 }, (_, i) =>
        designation(
          `d${i}`,
          `D${i}`,
          Array.from({ length: 1 + rnd(8) }, (_, j) => member(rnd(3) === 0 ? `b${rnd(40)}-${i}-${j}`.replace(/-.*/, "") : null, classes[rnd(2)] ?? "A", rnd(20) - 10, rnd(20) - 10)).filter(
            (m, k, all) => m.id === null || all.findIndex((o) => o.id === m.id) === k,
          ),
        ),
      );
      const result = matchDesignations(ds, bs);
      const seen = new Set<string>();
      result.forEach((r, i) => {
        expect(r.matched + r.missing).toBe(ds[i]?.members.length);
        expect(r.matched).toBe(r.buildingIds.length);
        for (const id of r.buildingIds) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
      });
    }
  });
});

describe("findOverlap edges", () => {
  const other = { id: "o", name: "Other", members: [member("b1", "S", 10, 10), member(null, "S", -5, -5)] };

  it("negative coordinates overlap on the exact position", () => {
    expect(findOverlap([member(null, "S", -5, -5)], [other])).toEqual({ id: "o", name: "Other" });
  });

  it("a null id never overlaps another null id on its own", () => {
    expect(findOverlap([member(null, "S", 11, 11)], [{ id: "o", name: "O", members: [member(null, "S", 12, 12)] }])).toBeUndefined();
  });

  it("two different ids are different buildings, even at one class and position", () => {
    expect(findOverlap([member("b2", "S", 10, 10)], [other])).toBeUndefined();
  });

  it("falls back to class and position when either side has no id", () => {
    expect(findOverlap([member(null, "S", 10, 10)], [other])).toEqual({ id: "o", name: "Other" });
    expect(findOverlap([member("x", "S", -5, -5)], [other])).toEqual({ id: "o", name: "Other" });
  });

  it("no others and a hostile id are both fine", () => {
    expect(findOverlap([member("__proto__", "S", 0, 0)], [])).toBeUndefined();
    expect(findOverlap([member("__proto__", "S", 0, 0)], [other])).toBeUndefined();
  });
});
