import type {
  PlannerDesignationMatch,
  PlannerDesignationsResponse,
  PlannerFactory,
  PlannerNode,
  PlannerShare,
  ProductionGraphResponse,
} from "@satisfactory-dash/shared";
import type { StoredDesignation } from "./designationStore";
import * as world from "./world";

/**
 * The demo's designations in memory (ADR-0026, ADR-0055 #727): seeded from the made-up world's plastic line, changed by
 * the demo's create, update, remove and replace handlers, and applied to the world's production graph so a merge, split,
 * pop-out or dissolve shows on the planner. A reload starts over. The reduction here is the demo's own small stand-in for
 * the backend's (a group joins the designation holding most of its machines); it only has to look right on made-up data.
 */

let stored: StoredDesignation[] | null = null;

export function demoDesignations(): StoredDesignation[] {
  stored ??= world.plannerDesignations().designations.map((d) => ({ ...d, revision: 1 }));
  return stored;
}

export function setDemoDesignations(next: StoredDesignation[]): void {
  stored = next;
}

export function resetDemoDesignations(): void {
  stored = null;
}

/** Each building of the world, by id, with its class: what a member is matched to. */
const classById = () => new Map(world.factory(world.DEMO_EPOCH).data.buildings.map((b) => [b.id, b.className]));

/** The list read: oldest first, each with its match (one building per member, the older designation keeps a shared one). */
export function demoDesignationsResponse(): PlannerDesignationsResponse {
  const list = demoDesignations();
  const classes = classById();
  const holder = new Map<string, StoredDesignation>();
  const matches: PlannerDesignationMatch[] = list.map((d) => {
    let claimed = 0;
    let by: StoredDesignation | undefined;
    const memberBuildingIds = d.members.map((m) => {
      if (m.id === null || classes.get(m.id) !== m.c) return null;
      const older = holder.get(m.id);
      if (older !== undefined) {
        claimed += 1;
        by ??= older;
        return null;
      }
      holder.set(m.id, d);
      return m.id;
    });
    const matched = memberBuildingIds.filter((id) => id !== null).length;
    return {
      designationId: d.id,
      matched,
      missing: d.members.length - matched,
      memberBuildingIds,
      ...(by === undefined ? {} : { claimedBy: { id: by.id, name: by.name, count: claimed } }),
    };
  });
  return { designations: list.map((d) => ({ ...d })), matches };
}

const designatedKey = (id: string) => `factory|designation|${id}`;
const isMachine = (n: PlannerNode) => n.kind === "machines" || n.kind === "extractor";

/** The world's production graph with the current designations applied: designated factories first, then the automatic ones. */
export function withDemoDesignations(response: ProductionGraphResponse): ProductionGraphResponse {
  const data = response.data;
  const list = demoDesignations();
  const holder = new Map<string, string>();
  for (const d of list) for (const m of d.members) if (m.id !== null && !holder.has(m.id)) holder.set(m.id, d.id);
  // The world's own factories, as the automatic ones they are without a designation.
  const base = data.factories ?? [];
  const baseOf = new Map(data.nodes.map((n) => [n.key, n.factoryKey]));
  const owner = new Map<string, string>();
  for (const n of data.nodes) {
    const counts = new Map<string, number>();
    for (const id of n.machineIds) {
      const d = holder.get(id);
      if (d !== undefined) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    let best: string | undefined;
    for (const [d, c] of counts) if (best === undefined || c > counts.get(best)!) best = d;
    const fallback = n.factoryKey ?? base.find((f) => f.nodeKeys.includes(n.key))?.key;
    if (best !== undefined) owner.set(n.key, designatedKey(best));
    else if (fallback !== undefined) owner.set(n.key, fallback);
  }
  // A group no member can name (storage, a sink, a station: no placed machine) follows its world factory's machines once
  // they have all gone to designations, so a merged factory keeps its ends, as the backend's flow-based reduction does.
  const placed = new Set(world.factory(world.DEMO_EPOCH).data.buildings.flatMap((b) => (b.location === undefined ? [] : [b.id])));
  const isPlaced = (n: PlannerNode) => n.machineIds.some((id) => placed.has(id));
  for (const f of base) {
    const mine = data.nodes.filter((n) => baseOf.get(n.key) === f.key);
    const real = mine.filter(isPlaced);
    if (real.length === 0 || real.some((n) => owner.get(n.key) === f.key)) continue;
    const tally = new Map<string, number>();
    for (const n of real) tally.set(owner.get(n.key)!, (tally.get(owner.get(n.key)!) ?? 0) + n.count);
    const target = [...tally].sort((a, b) => b[1] - a[1])[0]![0];
    for (const n of mine) if (!isPlaced(n)) owner.set(n.key, target);
  }
  const nodesOf = (key: string) => data.nodes.filter((n) => owner.get(n.key) === key);
  // Where a world factory's shares now point: itself while it has groups left, else where most of its groups went.
  const moved = new Map<string, string>();
  for (const f of base) {
    if (nodesOf(f.key).length > 0) {
      moved.set(f.key, f.key);
      continue;
    }
    const tally = new Map<string, number>();
    for (const n of data.nodes) if (baseOf.get(n.key) === f.key) tally.set(owner.get(n.key)!, (tally.get(owner.get(n.key)!) ?? 0) + n.count);
    const top = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (top !== undefined) moved.set(f.key, top[0]);
  }
  const nodes = data.nodes.map((n) => {
    const merged = new Map<string, number>();
    for (const s of n.shares ?? []) {
      const key = moved.get(s.factoryKey) ?? s.factoryKey;
      merged.set(key, (merged.get(key) ?? 0) + s.share);
    }
    const shares: PlannerShare[] = [...merged].map(([factoryKey, share]) => ({ factoryKey, share }));
    const next: PlannerNode = { ...n };
    const home = owner.get(n.key);
    if (home !== undefined) next.factoryKey = home;
    // Shared between factories only while its shares still name more than one.
    if (shares.length > 1) next.shares = shares;
    else delete next.shares;
    return next;
  });
  const factoryOf = (key: string, name: string, designationId: string | null, products: PlannerFactory["products"], sideProducts: string[]): PlannerFactory => {
    const mine = nodes.filter((n) => n.factoryKey === key);
    return {
      key,
      name,
      designationId,
      products,
      sideProducts,
      nodeKeys: mine.map((n) => n.key),
      siteKeys: [...new Set(mine.map((n) => n.siteKey))],
      machineCount: mine.filter(isMachine).reduce((sum, n) => sum + n.count, 0),
      sharedNodeCount: mine.filter((n) => (n.shares?.length ?? 0) > 1).length,
    };
  };
  const productsOf = (key: string) => {
    const made = new Set(nodes.filter((n) => n.factoryKey === key).flatMap((n) => n.products.map((p) => p.className)));
    const seen = new Set<string>();
    return base.flatMap((f) => f.products).filter((p) => made.has(p.className) && !seen.has(p.className) && seen.add(p.className));
  };
  const designated = list.flatMap((d) => {
    const key = designatedKey(d.id);
    return nodesOf(key).length === 0 ? [] : [factoryOf(key, d.name, d.id, productsOf(key), [])];
  });
  const automatic = base.flatMap((f) => {
    if (nodesOf(f.key).length === 0) return [];
    // A world factory the player designated is named by what it makes once it is automatic again.
    const name = f.designationId === null ? f.name : `${f.products[0]?.name ?? "Unnamed"} factory`;
    return [factoryOf(f.key, name, null, productsOf(f.key), f.designationId === null ? f.sideProducts : [])];
  });
  return { ...response, data: { ...data, nodes, factories: [...designated, ...automatic] } };
}
