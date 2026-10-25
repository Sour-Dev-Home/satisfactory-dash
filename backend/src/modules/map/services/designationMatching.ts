import { PLANNER_DESIGNATION_MATCH_RADIUS_METRES } from "@satisfactory-dash/shared";
import type { PlannerDesignationMember } from "@satisfactory-dash/shared";

/**
 * ADR-0055 Decision 5: the pure parts of Planner designations. No I/O, so they are unit-tested on plain data.
 *
 * OVERLAP (on write): a new member belongs to another designation when they share the building id, else the same
 * (class, x, y). MATCHING (on read, never stored): a member is found in the live factory by the building id, else an
 * exact (class, x, y), else the nearest building of the same class within the match radius; one-to-one, in member order,
 * and the OLDER designation keeps a building both name.
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
  const mine = new Set<string>();
  const myIds = new Set<string>();
  for (const m of members) {
    mine.add(keyOf(m.c, m.x, m.y));
    if (m.id !== null) myIds.add(m.id);
  }
  for (const other of others) {
    for (const o of other.members) {
      if ((o.id !== null && myIds.has(o.id)) || mine.has(keyOf(o.c, o.x, o.y))) return { id: other.id, name: other.name };
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
  near(c: string, x: number, y: number, skip: (b: DesignationBuilding) => boolean): DesignationBuilding | undefined {
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
          if (dist > PLANNER_DESIGNATION_MATCH_RADIUS_METRES) continue;
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
  return designations.map((d): DesignationMatch => {
    const buildingIds: string[] = [];
    const lostTo = new Map<string, number>(); // older designation id -> members it took from this one
    const mineHere = (b: DesignationBuilding) => holder.get(b.id) === d.id;
    for (const m of d.members) {
      // The building id first; when the live factory has no such building, position and class.
      const byGameId = m.id === null ? undefined : index.get(m.id);
      const found = byGameId ?? index.near(m.c, m.x, m.y, mineHere);
      if (found === undefined || mineHere(found)) continue;
      const owner = holder.get(found.id);
      if (owner !== undefined) {
        lostTo.set(owner, (lostTo.get(owner) ?? 0) + 1);
      } else {
        holder.set(found.id, d.id);
        buildingIds.push(found.id);
      }
    }
    let claimedBy: DesignationMatch["claimedBy"];
    for (const [ownerId, count] of lostTo) {
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
