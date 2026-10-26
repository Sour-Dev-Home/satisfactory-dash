import {
  PLANNER_DESIGNATION_MATCH_RADIUS_METRES,
  PLANNER_DESIGNATION_MAX_MEMBERS,
  type FactoryBuilding,
  type PlannerDesignation,
  type PlannerDesignationMember,
  type PlannerNode,
} from "@satisfactory-dash/shared";

/** A live building as a designation member records it: its class and whole-metre position. */
export interface Place {
  c: string;
  x: number;
  y: number;
  /** Unrounded, for the radius test. */
  mx: number;
  my: number;
}

/** The Factory read's buildings by id. Buildings without a position are left out: a member needs one. */
export function placesOf(buildings: readonly FactoryBuilding[]): Map<string, Place> {
  const places = new Map<string, Place>();
  for (const b of buildings) {
    if (b.location === undefined) continue;
    places.set(b.id, { c: b.className, x: Math.round(b.location.xM), y: Math.round(b.location.yM), mx: b.location.xM, my: b.location.yM });
  }
  return places;
}

export type MembersResult = { ok: true; members: PlannerDesignationMember[] } | { ok: false; reason: string };

/**
 * The designation members for some groups: each group's machines, found again in the Factory read by id. A machine with no
 * position is skipped (it could not be found again); none at all, or more than a designation holds, is a reason instead.
 */
export function membersOf(nodes: readonly PlannerNode[], places: ReadonlyMap<string, Place>): MembersResult {
  const seen = new Set<string>();
  const members: PlannerDesignationMember[] = [];
  let listed = 0;
  for (const node of nodes) {
    // The graph lists at most so many ids per group; a bigger group would be designated in part.
    if (node.machineIds.length < node.count) return { ok: false, reason: "These groups are too large to designate whole." };
    for (const id of node.machineIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      listed += 1;
      const place = places.get(id);
      if (place !== undefined) members.push({ id, c: place.c, x: place.x, y: place.y });
    }
  }
  if (listed > PLANNER_DESIGNATION_MAX_MEMBERS) {
    return { ok: false, reason: `A factory can name up to ${PLANNER_DESIGNATION_MAX_MEMBERS} machines; select fewer groups.` };
  }
  if (members.length === 0) return { ok: false, reason: "The positions of these machines aren't known yet." };
  return { ok: true, members };
}

/**
 * Which members of each designation the live buildings no longer hold, by the backend's rules (plannerDesignations.ts):
 * passes over every designation oldest first (the game's id with the same class; an exact class and place; the nearest of
 * the class within the radius), one building per member. `designations` come oldest first, as the list sends them.
 */
export function missingMembers(designations: readonly PlannerDesignation[], places: ReadonlyMap<string, Place>): Map<string, PlannerDesignationMember[]> {
  const taken = new Set<string>();
  const found = new Set<PlannerDesignationMember>();
  const claim = (member: PlannerDesignationMember, id: string) => {
    taken.add(id);
    found.add(member);
  };
  const members = designations.flatMap((d) => d.members);
  for (const m of members) {
    const place = m.id === null ? undefined : places.get(m.id);
    if (m.id !== null && place !== undefined && place.c === m.c && !taken.has(m.id)) claim(m, m.id);
  }
  for (const m of members) {
    if (found.has(m)) continue;
    for (const [id, p] of places) {
      if (!taken.has(id) && p.c === m.c && p.x === m.x && p.y === m.y) {
        claim(m, id);
        break;
      }
    }
  }
  const pairs: { m: PlannerDesignationMember; id: string; d: number }[] = [];
  for (const m of members) {
    if (found.has(m)) continue;
    for (const [id, p] of places) {
      const d = Math.hypot(p.mx - m.x, p.my - m.y);
      if (!taken.has(id) && p.c === m.c && d <= PLANNER_DESIGNATION_MATCH_RADIUS_METRES) pairs.push({ m, id, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const { m, id } of pairs) if (!found.has(m) && !taken.has(id)) claim(m, id);
  return new Map(designations.map((d) => [d.id, d.members.filter((m) => !found.has(m))]));
}
