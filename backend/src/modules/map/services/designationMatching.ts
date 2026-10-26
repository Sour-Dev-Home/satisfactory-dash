import { PLANNER_DESIGNATION_MATCH_RADIUS_METRES } from "@satisfactory-dash/shared";
import type { PlannerDesignationMember } from "@satisfactory-dash/shared";

/**
 * ADR-0055 Decision 5: the pure parts of Planner designations. No I/O, so they are unit-tested on plain data.
 *
 * OVERLAP (on write): a new member belongs to another designation when they share the building id; the same (class, x, y)
 * counts only when either side has no id. MATCHING (on read, never stored): in passes, oldest designation first: the
 * building id (same class), then an exact (class, x, y), then the nearest free building of the class within the match
 * radius; one-to-one, independent of member order, and the OLDER designation keeps a building both name.
 */

/** A live building as the designations see it: the game's id, class and position in metres (not rounded). */
export interface DesignationBuilding {
  id: string;
  c: string;
  x: number;
  y: number;
}

/** What matching needs of a stored designation. `list` must be oldest first. */
export interface MatchableDesignation {
  id: string;
  name: string;
  members: readonly PlannerDesignationMember[];
}

export interface DesignationMatch {
  designationId: string;
  matched: number;
  missing: number;
  claimedBy?: { id: string; name: string; count: number };
  /** The live buildings this designation holds (it kept them), in member order. For the reduction; not in the API. */
  buildingIds: string[];
}

// Strings from outside never index a plain object: Maps only.
const keyOf = (c: string, x: number, y: number): string => `${c}\u0000${x}\u0000${y}`;

export interface OverlapOwner {
  id: string;
  name: string;
  members: readonly PlannerDesignationMember[];
}

/**
 * The first of `others` (give them oldest first) that holds a building also named in `members`, or undefined. Used inside
 * the write transaction, against the rows it just locked.
 */
export function findOverlap(members: readonly PlannerDesignationMember[], others: readonly OverlapOwner[]): { id: string; name: string } | undefined {
  const mineByKey = new Set<string>(); // keys of my members without an id
  const myIds = new Set<string>();
  for (const m of members) {
    if (m.id !== null) myIds.add(m.id);
    else mineByKey.add(keyOf(m.c, m.x, m.y));
  }
  const myKeys = new Set(members.map((m) => keyOf(m.c, m.x, m.y)));
  for (const other of others) {
    for (const o of other.members) {
      // Two ids settle it: different ids are different buildings, even at one class and position. Position only when a side has no id.
      if (o.id !== null) {
        if (myIds.has(o.id) || mineByKey.has(keyOf(o.c, o.x, o.y))) return { id: other.id, name: other.name };
      } else if (myKeys.has(keyOf(o.c, o.x, o.y))) return { id: other.id, name: other.name };
    }
  }
  return undefined;
}

const CELL = PLANNER_DESIGNATION_MATCH_RADIUS_METRES;

class BuildingIndex {
  private readonly byId = new Map<string, DesignationBuilding>();
  private readonly cells = new Map<string, DesignationBuilding[]>();

  constructor(buildings: readonly DesignationBuilding[]) {
    for (const b of buildings) {
      if (!this.byId.has(b.id)) this.byId.set(b.id, b);
      const cell = this.cellKey(b.c, b.x, b.y);
      const list = this.cells.get(cell);
      if (list) list.push(b);
      else this.cells.set(cell, [b]);
    }
  }

  private cellKey(c: string, x: number, y: number): string {
    return `${c}\u0000${Math.floor(x / CELL)}\u0000${Math.floor(y / CELL)}`;
  }

  get(id: string): DesignationBuilding | undefined {
    return this.byId.get(id);
  }

  /** The buildings of the class within the radius of (x, y), nearest first (an exact whole-metre hit counts as distance 0),
   *  ties by id so the answer never depends on input order. `skip` removes the ones already held. */
  near(c: string, x: number, y: number, skip: (b: DesignationBuilding) => boolean, radius = PLANNER_DESIGNATION_MATCH_RADIUS_METRES): DesignationBuilding | undefined {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    let best: DesignationBuilding | undefined;
    let bestDist = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const b of this.cells.get(`${c}\u0000${cx + dx}\u0000${cy + dy}`) ?? []) {
          if (skip(b)) continue;
          const exact = Math.round(b.x) === x && Math.round(b.y) === y;
          const dist = exact ? 0 : Math.hypot(b.x - x, b.y - y);
          if (dist > radius) continue;
          if (dist < bestDist || (dist === bestDist && best !== undefined && b.id < best.id)) {
            best = b;
            bestDist = dist;
          }
        }
      }
    }
    return best;
  }
}

/**
 * One match entry per designation, in the order given (oldest first). With `buildings` null (no snapshot yet) every member
 * is missing: never an error and never a reason to delete anything.
 */
export function matchDesignations(designations: readonly MatchableDesignation[], buildings: readonly DesignationBuilding[] | null): DesignationMatch[] {
  const index = new BuildingIndex(buildings ?? []);
  const holder = new Map<string, string>(); // building id -> the designation that kept it
  const byId = new Map(designations.map((d) => [d.id, d] as const));
  // Per designation: the building each member (by index) ended on, and the members taken from it by older designations.
  const found = designations.map((d) => Array.from<string | undefined>({ length: d.members.length }));
  const resolved = designations.map((d) => Array.from<boolean>({ length: d.members.length }).fill(false));
  const lostTo = designations.map(() => new Map<string, number>()); // older designation id -> members it took from this one
  const lose = (di: number, owner: string): void => {
    lostTo[di]!.set(owner, (lostTo[di]!.get(owner) ?? 0) + 1);
  };

  // Pass 1: the building id, for every member of every designation, oldest designation first. The class must agree: an id
  // on another class is stale and the member falls through to the position passes.
  designations.forEach((d, di) => {
    d.members.forEach((m, mi) => {
      const b = m.id === null ? undefined : index.get(m.id);
      if (b === undefined || b.c !== m.c) return;
      resolved[di]![mi] = true;
      const owner = holder.get(b.id);
      if (owner === undefined) {
        holder.set(b.id, d.id);
        found[di]![mi] = b.id;
      } else if (owner !== d.id) lose(di, owner);
    });
  });

  // Members in a fixed order (class, x, y, id) so the position passes never depend on the order they were stored in.
  const sorted = designations.map((d) =>
    d.members
      .map((m, mi) => ({ m, mi }))
      .sort((a, b) => (a.m.c < b.m.c ? -1 : a.m.c > b.m.c ? 1 : a.m.x - b.m.x || a.m.y - b.m.y || (a.m.id ?? "").localeCompare(b.m.id ?? ""))),
  );
  const isHeld = (b: DesignationBuilding): boolean => holder.has(b.id);

  // Pass 2: an exact (class, x, y) for those still unmatched. Pass 3: the nearest free of the class within the radius; a
  // member with none is missing, and when the building it would have taken is held by an older designation, it is claimed.
  for (const pass of [2, 3] as const) {
    designations.forEach((d, di) => {
      for (const { m, mi } of sorted[di]!) {
        if (resolved[di]![mi]) continue;
        const b = index.near(m.c, m.x, m.y, isHeld, pass === 2 ? 0 : PLANNER_DESIGNATION_MATCH_RADIUS_METRES);
        if (b !== undefined) {
          holder.set(b.id, d.id);
          found[di]![mi] = b.id;
          resolved[di]![mi] = true;
        } else if (pass === 3) {
          resolved[di]![mi] = true;
          const would = index.near(m.c, m.x, m.y, (x) => holder.get(x.id) === d.id);
          const owner = would === undefined ? undefined : holder.get(would.id);
          if (owner !== undefined) lose(di, owner);
        }
      }
    });
  }

  return designations.map((d, di): DesignationMatch => {
    const buildingIds = found[di]!.filter((id): id is string => id !== undefined);
    let claimedBy: DesignationMatch["claimedBy"];
    for (const [ownerId, count] of lostTo[di]!) {
      const owner = byId.get(ownerId);
      if (owner !== undefined && (claimedBy === undefined || count > claimedBy.count)) claimedBy = { id: owner.id, name: owner.name, count };
    }
    return {
      designationId: d.id,
      matched: buildingIds.length,
      missing: d.members.length - buildingIds.length,
      ...(claimedBy !== undefined && { claimedBy }),
      buildingIds,
    };
  });
}
