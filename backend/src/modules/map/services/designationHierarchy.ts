import { PLANNER_DESIGNATION_MAX_DEPTH } from "@satisfactory-dash/shared";

/**
 * ADR-0061 Decision 1: the rules a designation tree must meet after a write, checked against the WHOLE resulting set
 * (the store holds the server lock, so that set is exact). Pure, so the database store and the route tests' stand-in run
 * the same code. Checked in this order, the first breach wins:
 *
 *   stale   a `parentId` names a designation that is not in the set (gone, or removed by this same replace);
 *   cycle   following parents comes back to a designation (a self-parent included);
 *   depth   a designation is nested deeper than PLANNER_DESIGNATION_MAX_DEPTH (top level is 1), which covers a move that
 *           pushes a whole subtree past the limit;
 *   shape   a designation has no members and no children.
 *
 * Every write of this build keeps these true, but the previous build (no `parent_id`) can leave a parent with no members
 * and no children (it deletes a leaf child), so `tolerated` names shape breaches that were there BEFORE the write and that
 * the write does not touch: they never block an unrelated write (ADR-0049 D6, roll forward after a rollback). The
 * previous build never sets a parent, so it cannot leave a cycle, a too-deep nesting or a missing parent.
 */
export interface HierarchyNode {
  id: string;
  parentId: string | null;
  memberCount: number;
}

export type HierarchyBreach = { kind: "stale"; ids: string[] } | { kind: "cycle" } | { kind: "depth" } | { kind: "shape" };

export function checkHierarchy(nodes: readonly HierarchyNode[], tolerated: ReadonlySet<string> = new Set()): HierarchyBreach | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const missing = nodes.flatMap((n) => (n.parentId !== null && !byId.has(n.parentId) ? [n.parentId] : []));
  if (missing.length > 0) return { kind: "stale", ids: [...new Set(missing)] };

  // Depth by walking up; a walk longer than the set has a cycle. Memoised, so the whole check is O(n).
  const depth = new Map<string, number>();
  for (const start of nodes) {
    const path: HierarchyNode[] = [];
    const onPath = new Set<string>();
    let at: HierarchyNode | undefined = start;
    while (at !== undefined && !depth.has(at.id)) {
      if (onPath.has(at.id)) return { kind: "cycle" };
      onPath.add(at.id);
      path.push(at);
      at = at.parentId === null ? undefined : byId.get(at.parentId);
    }
    let d = at === undefined ? 0 : (depth.get(at.id) as number);
    for (let i = path.length - 1; i >= 0; i--) depth.set(path[i].id, ++d);
  }
  if ([...depth.values()].some((d) => d > PLANNER_DESIGNATION_MAX_DEPTH)) return { kind: "depth" };

  if ([...shapeBreaches(nodes)].some((id) => !tolerated.has(id))) return { kind: "shape" };
  return undefined;
}

/** The designations with no members and no children (ADR-0061 Decision 1 does not allow them). */
export function shapeBreaches(nodes: readonly HierarchyNode[]): Set<string> {
  const parents = new Set(nodes.flatMap((n) => (n.parentId === null ? [] : [n.parentId])));
  return new Set(nodes.filter((n) => n.memberCount === 0 && !parents.has(n.id)).map((n) => n.id));
}

/** The shape breaches already in `before` that a write naming `written` (its put ids) leaves alone: tolerated. */
export function untouchedBreaches(before: readonly HierarchyNode[], written: Iterable<string>): Set<string> {
  const out = shapeBreaches(before);
  for (const id of written) out.delete(id);
  return out;
}

/**
 * DELETE (ADR-0061): deleting `removedId` when it has no children can leave its parent with no members and no children,
 * which is not allowed (Decision 1); that parent goes too, and so on up. Nearest first, so each delete leaves nothing
 * pointing at the row it deletes. Empty when `removedId` has children (they move up, so its parent keeps children).
 */
export function emptiedAncestors(nodes: readonly HierarchyNode[], removedId: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const gone = new Set([removedId]);
  const childCount = new Map<string, number>();
  for (const n of nodes) if (n.parentId !== null) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1);
  if ((childCount.get(removedId) ?? 0) > 0) return [];
  const out: string[] = [];
  let at = byId.get(removedId);
  while (at !== undefined && at.parentId !== null) {
    const parent = byId.get(at.parentId);
    if (parent === undefined || gone.has(parent.id)) break;
    // The parent loses `at`; it goes only when that was its last child and it owns no machines.
    if (parent.memberCount > 0 || (childCount.get(parent.id) ?? 0) > 1) break;
    gone.add(parent.id);
    out.push(parent.id);
    at = parent;
  }
  return out;
}

/**
 * The order to insert new designations so each one's parent row exists first (a parent that is not being inserted
 * already exists). Call it only on a set `checkHierarchy` passed, so there is no cycle; the result keeps the input order
 * among designations that do not depend on each other.
 */
export function parentsFirst<T extends { id: string; parentId: string | null }>(inserts: readonly T[]): T[] {
  const byId = new Map(inserts.map((n) => [n.id, n] as const));
  const out: T[] = [];
  const done = new Set<string>();
  const visit = (n: T): void => {
    if (done.has(n.id)) return;
    done.add(n.id);
    const parent = n.parentId === null ? undefined : byId.get(n.parentId);
    if (parent !== undefined) visit(parent);
    out.push(n);
  };
  inserts.forEach(visit);
  return out;
}
