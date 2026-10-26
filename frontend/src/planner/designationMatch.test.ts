import { describe, expect, it } from "vitest";
import type { FactoryBuilding, PlannerDesignation, PlannerNode } from "@satisfactory-dash/shared";
import { membersOf, missingMembers, placesOf } from "./designationMatch";

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

  it("says so when the graph listed fewer ids than the group has machines, or none can be placed", () => {
    expect(membersOf([group(["a"], 5)], places)).toMatchObject({ ok: false });
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
