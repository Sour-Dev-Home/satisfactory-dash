import type { PlannerDesignationMember } from "@satisfactory-dash/shared";

/**
 * The contract's write-overlap rule (plannerDesignations.ts): two members are the same building when they share a building
 * id, or the same (class, x, y) when a side has no id. No imports beyond the contract's types: the demo's in-memory
 * store uses it too, and must not pull in the API layer (the demo transport imports the store).
 */
export class Buildings {
  private readonly ids = new Set<string>();
  private readonly keysWithoutId = new Set<string>();
  private readonly allKeys = new Set<string>();
  private static key = (m: PlannerDesignationMember) => `${m.c}\u0000${m.x}\u0000${m.y}`;
  has(m: PlannerDesignationMember): boolean {
    const key = Buildings.key(m);
    return m.id !== null ? this.ids.has(m.id) || this.keysWithoutId.has(key) : this.allKeys.has(key);
  }
  add(m: PlannerDesignationMember): void {
    if (m.id !== null) this.ids.add(m.id);
    else this.keysWithoutId.add(Buildings.key(m));
    this.allKeys.add(Buildings.key(m));
  }
}

/** The first member of `members` that is the same building as one in `others`, if any. */
export function sharedBuilding(members: readonly PlannerDesignationMember[], others: readonly PlannerDesignationMember[]): PlannerDesignationMember | undefined {
  const taken = new Buildings();
  for (const m of others) taken.add(m);
  return members.find((m) => taken.has(m));
}
