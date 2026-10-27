import { describe, expect, it } from "vitest";
import { PLANNER_MAX_MACHINE_IDS, type FactoryBuilding, type PlannerDesignation, type PlannerNode } from "@satisfactory-dash/shared";
import { listedInPart, membersOf, missingMembers, placesOf } from "./designationMatch";

const building = (id: string, className: string, xM: number, yM: number) =>
  ({ id, className, location: { xM, yM, zM: 0, rotationDeg: 0 } }) as unknown as FactoryBuilding;
const designation = (id: string, members: PlannerDesignation["members"]): PlannerDesignation => ({
  id,
  name: id,
  mode: "core",
  members,
  createdAt: "2026-10-24T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:00.000Z",
});
const group = (ids: string[], count = ids.length) => ({ machineIds: ids, count }) as unknown as PlannerNode;

describe("membersOf", () => {
  const places = placesOf([building("a", "C", 1.6, -2.4), building("b", "C", 10, 10), { ...building("c", "C", 0, 0), location: undefined } as FactoryBuilding]);

  it("records each machine once with its class and whole-metre place, skipping one with no position", () => {
    const made = membersOf([group(["a", "b"]), group(["b", "c"])], places);
    expect(made).toEqual({ ok: true, members: [{ id: "a", c: "C", x: 2, y: -2 }, { id: "b", c: "C", x: 10, y: 10 }] });
  });

  it("says so when the graph cut a group's ids at the cap, or none can be placed", () => {
    const cut = Array.from({ length: PLANNER_MAX_MACHINE_IDS }, (_, i) => `m${i}`);
    expect(membersOf([group(cut, PLANNER_MAX_MACHINE_IDS + 1)], places)).toEqual({ ok: false, reason: "These groups are too large to designate whole." });
    // Below the cap a short list is whole: the rest are ends with no building (storage, a stale end), never members.
    expect(membersOf([group(["a"], 5)], places)).toEqual({ ok: true, members: [{ id: "a", c: "C", x: 2, y: -2 }] });
    // Exactly at the cap with every machine listed is whole; a count short of the ids is not a cut either.
    const full = Array.from({ length: PLANNER_MAX_MACHINE_IDS }, (_, i) => `m${i}`);
    expect(listedInPart(group(full, PLANNER_MAX_MACHINE_IDS))).toBe(false);
    expect(listedInPart(group(full, PLANNER_MAX_MACHINE_IDS + 1))).toBe(true);
    expect(listedInPart(group(full.slice(1), PLANNER_MAX_MACHINE_IDS + 5))).toBe(false);
    expect(membersOf([group(["c"])], places)).toMatchObject({ ok: false, reason: "The positions of these machines aren't known yet." });
  });
});

describe("missingMembers", () => {
  it("matches by id and class first, then by place, then by the nearest of the class within the radius", () => {
    const places = placesOf([building("a", "C", 0, 0), building("b", "C", 50, 50), building("d", "D", 90, 90)]);
    const d = designation("old", [
      { id: "a", c: "C", x: 5, y: 5 },
      { id: "zz", c: "C", x: 50, y: 50 },
      { id: null, c: "D", x: 91, y: 90 },
      { id: "a2", c: "D", x: 300, y: 300 },
    ]);
    const lost = missingMembers([d], places).get("old");
    expect(lost).toEqual([{ id: "a2", c: "D", x: 300, y: 300 }]);
  });

  it("gives a building to the older designation; the newer one's member is missing", () => {
    const places = placesOf([building("a", "C", 0, 0)]);
    const older = designation("old", [{ id: "a", c: "C", x: 0, y: 0 }]);
    const newer = designation("new", [{ id: null, c: "C", x: 0, y: 0 }]);
    const lost = missingMembers([older, newer], places);
    expect(lost.get("old")).toEqual([]);
    expect(lost.get("new")).toHaveLength(1);
  });

  it("does not take an id match on another class", () => {
    const places = placesOf([building("a", "D", 0, 0)]);
    expect(missingMembers([designation("x", [{ id: "a", c: "C", x: 40, y: 40 }])], places).get("x")).toHaveLength(1);
  });
});
