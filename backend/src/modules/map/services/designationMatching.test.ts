import { describe, expect, it } from "vitest";
import { findOverlap, matchDesignations } from "./designationMatching.js";
import type { DesignationBuilding, MatchableDesignation } from "./designationMatching.js";

const member = (id: string | null, c: string, x: number, y: number) => ({ id, c, x, y });
const building = (id: string, c: string, x: number, y: number): DesignationBuilding => ({ id, c, x, y });
const designation = (id: string, name: string, members: MatchableDesignation["members"]): MatchableDesignation => ({ id, name, members });

describe("findOverlap", () => {
  const older = designation("d1", "Older", [member("b1", "Smelter", 10, 10), member(null, "Constructor", 20, 20)]);

  it("is undefined when nothing is shared", () => {
    expect(findOverlap([member("b9", "Smelter", 50, 50)], [older])).toBeUndefined();
  });

  it("names the other designation when the building id is shared", () => {
    expect(findOverlap([member("b1", "Smelter", 99, 99)], [older])).toEqual({ id: "d1", name: "Older" });
  });

  it("names it when only the (class, x, y) is shared", () => {
    expect(findOverlap([member("x7", "Constructor", 20, 20)], [older])).toEqual({ id: "d1", name: "Older" });
  });

  it("the same position with another class is not a shared building", () => {
    expect(findOverlap([member(null, "Assembler", 20, 20)], [older])).toBeUndefined();
  });

  it("reports the first of several", () => {
    const second = designation("d2", "Second", [member("b1", "Smelter", 10, 10)]);
    expect(findOverlap([member("b1", "Smelter", 10, 10)], [older, second])?.id).toBe("d1");
  });
});

describe("matchDesignations", () => {
  it("with no snapshot every member is missing and nothing throws", () => {
    const d = designation("d1", "A", [member("b1", "S", 1, 1), member(null, "S", 2, 2)]);
    expect(matchDesignations([d], null)).toEqual([{ designationId: "d1", matched: 0, missing: 2, buildingIds: [], memberBuildingIds: [null, null] }]);
    expect(matchDesignations([], null)).toEqual([]);
  });

  it("matches by the game's id first, wherever the building now stands", () => {
    const d = designation("d1", "A", [member("b1", "S", 1, 1)]);
    const [m] = matchDesignations([d], [building("b1", "S", 500, 500)]);
    expect(m).toMatchObject({ matched: 1, missing: 0, buildingIds: ["b1"] });
  });

  it("falls back to an exact (class, x, y) when the id is gone or absent", () => {
    const d = designation("d1", "A", [member("gone", "S", 10, 20), member(null, "S", 30, 40)]);
    const [m] = matchDesignations([d], [building("n1", "S", 10.3, 19.8), building("n2", "S", 30, 40)]);
    expect(m?.buildingIds).toEqual(["n1", "n2"]);
  });

  it("falls back to the nearest of the same class within 2 m, and not beyond", () => {
    const d = designation("d1", "A", [member(null, "S", 0, 0), member(null, "S", 100, 0)]);
    const [m] = matchDesignations([d], [building("far", "S", 1.9, 0), building("near", "S", 0.6, 0.3), building("out", "S", 102.5, 0)]);
    expect(m).toMatchObject({ matched: 1, missing: 1, buildingIds: ["near"] });
  });

  it("never matches across classes", () => {
    const d = designation("d1", "A", [member(null, "S", 0, 0)]);
    expect(matchDesignations([d], [building("c1", "C", 0, 0)])[0]).toMatchObject({ matched: 0, missing: 1 });
  });

  it("is one-to-one: two members do not both take one building", () => {
    const d = designation("d1", "A", [member(null, "S", 0, 0), member(null, "S", 1, 0)]);
    const [m] = matchDesignations([d], [building("only", "S", 0, 0)]);
    expect(m).toMatchObject({ matched: 1, missing: 1, buildingIds: ["only"] });
  });

  it("a second member takes the next nearest building when the nearest is already held by the first", () => {
    const d = designation("d1", "A", [member(null, "S", 0, 0), member(null, "S", 0, 0)]);
    const [m] = matchDesignations([d], [building("a", "S", 0, 0), building("b", "S", 1, 0)]);
    expect(m?.buildingIds).toEqual(["a", "b"]);
  });

  it("the older designation keeps a shared building and the newer reports claimedBy", () => {
    const older = designation("d1", "Older", [member("b1", "S", 0, 0), member("b2", "S", 5, 0)]);
    const newer = designation("d2", "Newer", [member("b1", "S", 0, 0), member("b2", "S", 5, 0), member("b3", "S", 9, 9)]);
    const buildings = [building("b1", "S", 0, 0), building("b2", "S", 5, 0), building("b3", "S", 9, 9)];
    const [a, b] = matchDesignations([older, newer], buildings);
    expect(a).toMatchObject({ matched: 2, missing: 0 });
    expect(a?.claimedBy).toBeUndefined();
    expect(b).toMatchObject({ matched: 1, missing: 2, claimedBy: { id: "d1", name: "Older", count: 2 }, buildingIds: ["b3"] });
  });

  it("matched plus missing is always the member count", () => {
    const d = designation("d1", "A", [member("x", "S", 0, 0), member(null, "S", 50, 50), member(null, "S", 0, 0)]);
    const [m] = matchDesignations([d], [building("a", "S", 0, 0)]);
    expect((m?.matched ?? 0) + (m?.missing ?? 0)).toBe(3);
  });

  it("does not depend on the order of the buildings", () => {
    const d = designation("d1", "A", [member(null, "S", 0, 0)]);
    const a = building("a", "S", 1, 0);
    const b = building("b", "S", -1, 0);
    expect(matchDesignations([d], [a, b])[0]?.buildingIds).toEqual(matchDesignations([d], [b, a])[0]?.buildingIds);
  });
});

describe("matchDesignations memberBuildingIds (ADR-0055 Decision 12)", () => {
  it("is aligned to members: one entry per member, null where none matched, non-null count = matched", () => {
    // Older holds b1 by id; the newer names b1 too (claimed), one by exact position, one by radius, one nowhere.
    const older = designation("d1", "Older", [member("b1", "S", 1, 1)]);
    const newer = designation("d2", "Newer", [
      member(null, "S", 90, 90), // nowhere
      member("b1", "S", 1, 1), // held by the older one
      member(null, "S", 10, 10), // exact position: b2
      member("gone", "S", 21, 20), // stale id, nearest within the radius: b3
    ]);
    const buildings = [building("b1", "S", 1, 1), building("b2", "S", 10, 10), building("b3", "S", 20, 20)];
    const [o, n] = matchDesignations([older, newer], buildings);
    expect(o?.memberBuildingIds).toEqual(["b1"]);
    expect(n?.memberBuildingIds).toEqual([null, null, "b2", "b3"]);
    for (const [d, match] of [[older, o], [newer, n]] as const) {
      expect(match?.memberBuildingIds).toHaveLength(d.members.length);
      expect(match?.memberBuildingIds.filter((id) => id !== null)).toHaveLength(match?.matched ?? -1);
      expect(match?.memberBuildingIds.filter((id) => id !== null)).toEqual(match?.buildingIds);
    }
  });

  it("does not depend on the order buildings arrive in, and stays aligned however members are ordered", () => {
    const d = designation("d1", "A", [member(null, "S", 5, 5), member("x", "S", 1, 1), member(null, "T", 3, 3)]);
    const buildings = [building("x", "S", 1, 1), building("s5", "S", 5, 5), building("t3", "T", 3, 3)];
    expect(matchDesignations([d], buildings)[0]?.memberBuildingIds).toEqual(["s5", "x", "t3"]);
    expect(matchDesignations([d], [...buildings].reverse())[0]?.memberBuildingIds).toEqual(["s5", "x", "t3"]);
  });
});
