import {
  PLANNER_DESIGNATION_MAX_DEPTH,
  PLANNER_DESIGNATION_MAX_MEMBERS,
  PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT,
  PLANNER_DESIGNATIONS_REPLACE_MAX_PUT,
  ReplacePlannerDesignationsRequestSchema,
  type PlannerDesignation,
  type PlannerDesignationMember,
  type PlannerNode,
  type ReplacePlannerDesignationsRequest,
  type ReplacePlannerDesignationsResponse,
} from "@satisfactory-dash/shared";
import { Buildings, sharedBuilding } from "./buildingOverlap";
import { CYCLE_TEXT, DEPTH_TEXT, SHAPE_TEXT, STALE_TEXT, nameProblem } from "./designationText";

/**
 * ADR-0055 Decisions 11 and 12 (#727): the replace requests for merge, split, pop-out, dissolve and undo, built from what
 * the page shows; ADR-0061 Decision 6 adds group, ungroup and move. Pure: no React, no network. Each builder answers the
 * request plus the pre-image (the designations as they were read, which undo restores), or the reason it cannot be sent.
 * The server re-checks everything; these checks only keep a request the server would refuse from being sent.
 */

export type ReplaceIntent = "merge" | "split" | "pop_out" | "dissolve" | "undo" | "group" | "ungroup" | "move";

export type OpResult =
  | { ok: true; request: ReplacePlannerDesignationsRequest; preImage: PlannerDesignation[] }
  | { ok: false; reason: string };

/** At most this many factories merge at once (ADR-0055 Decision 12: 2 to 10). */
export const MERGE_MAX = PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT;

export const NEEDS_NEWER_BACKEND = "This server's backend is too old to merge or split factories.";
export const TOO_FEW_TO_MERGE = "Select at least two factories to merge.";
export const TOO_MANY_TO_MERGE = `Merge up to ${MERGE_MAX} factories at once.`;
export const NOTHING_SELECTED_IN_FACTORY = "None of the selected machines are listed in this factory.";
export const WHOLE_FACTORY = "That is the whole factory; rename it instead.";
export const NOTHING_TO_UNDO = "There is nothing to undo.";

const tooManyMachines = (n: number) => `A factory can hold up to ${PLANNER_DESIGNATION_MAX_MEMBERS} machines; these have ${n}.`;

type Revised = PlannerDesignation & { revision: number };
const hasRevision = (d: PlannerDesignation): d is Revised => d.revision !== undefined;

/** The request as the contract checks it; a builder never hands out one the schema would refuse. */
function checked(request: ReplacePlannerDesignationsRequest, preImage: PlannerDesignation[]): OpResult {
  return ReplacePlannerDesignationsRequestSchema.safeParse(request).success
    ? { ok: true, request, preImage }
    : { ok: false, reason: "This change is too large to send in one go." };
}

/** Oldest first, by `createdAt`, keeping the given order on a tie (the list already comes oldest first). */
const oldestFirst = (list: readonly PlannerDesignation[]) =>
  list.map((d, i) => ({ d, i })).sort((a, b) => Date.parse(a.d.createdAt) - Date.parse(b.d.createdAt) || a.i - b.i).map((x) => x.d);

/** The name the merge dialog proposes: the largest source's (by machines), or empty when it would not pass as a name. */
export function proposedMergeName(sources: readonly { name: string; machineCount: number }[]): string {
  let best: { name: string; machineCount: number } | undefined;
  for (const s of sources) if (best === undefined || s.machineCount > best.machineCount) best = s;
  const name = (best?.name ?? "").slice(0, 64).trim();
  return nameProblem(name) === null ? name : "";
}

/** The name a popped-out group gets: what it makes and what it is, or a plain fallback when that is not a valid name. */
export function popOutName(node: Pick<PlannerNode, "name" | "recipe">): string {
  const name = (node.recipe === null ? node.name : `${node.recipe}, ${node.name}`).slice(0, 64).trim();
  return nameProblem(name) === null ? name : "Popped-out group";
}

/**
 * Merge (Decision 12): the selected designations and the machines of the selected suggestions into one. The result keeps
 * the oldest designation's id (and so its `createdAt` and matching priority); members are the union, oldest designation's
 * first, then the others oldest first, then each suggestion's, one per building.
 */
export function mergeRequest({
  designations,
  suggested,
  name,
}: {
  designations: readonly PlannerDesignation[];
  /** Each selected suggestion's machines as members (they are free buildings: a suggestion is never stored). */
  suggested: readonly (readonly PlannerDesignationMember[])[];
  name: string;
}): OpResult {
  const count = designations.length + suggested.length;
  if (count < 2) return { ok: false, reason: TOO_FEW_TO_MERGE };
  if (count > MERGE_MAX) return { ok: false, reason: TOO_MANY_TO_MERGE };
  if (!designations.every(hasRevision)) return { ok: false, reason: NEEDS_NEWER_BACKEND };
  const sorted = oldestFirst(designations) as Revised[];
  const taken = new Buildings();
  const members: PlannerDesignationMember[] = [];
  for (const m of [...sorted.flatMap((d) => d.members), ...suggested.flat()]) {
    if (taken.has(m)) continue;
    taken.add(m);
    members.push(m);
  }
  if (members.length > PLANNER_DESIGNATION_MAX_MEMBERS) return { ok: false, reason: tooManyMachines(members.length) };
  const keeper = sorted[0];
  return checked(
    {
      expect: sorted.map((d) => ({ id: d.id, revision: d.revision })),
      put: [{ ...(keeper === undefined ? {} : { id: keeper.id }), name, members }],
      intent: "merge",
    },
    sorted,
  );
}

/**
 * Split (Decision 12): the source's members whose matched building is among the selected machines move to a new
 * designation; the rest stay with the source under its id, including the members the matcher no longer finds. Uses the
 * backend's member-to-building ids (`memberBuildingIds`), never a guess of its own.
 */
export function splitRequest({
  source,
  memberBuildingIds,
  machineIds,
  name,
  intent = "split",
}: {
  source: PlannerDesignation;
  memberBuildingIds: readonly (string | null)[] | undefined;
  machineIds: ReadonlySet<string>;
  name: string;
  intent?: "split" | "pop_out";
}): OpResult {
  if (!hasRevision(source) || memberBuildingIds === undefined || memberBuildingIds.length !== source.members.length) {
    return { ok: false, reason: NEEDS_NEWER_BACKEND };
  }
  const kept: PlannerDesignationMember[] = [];
  const chosen: PlannerDesignationMember[] = [];
  source.members.forEach((m, i) => {
    const building = memberBuildingIds[i];
    (building != null && machineIds.has(building) ? chosen : kept).push(m);
  });
  if (chosen.length > 0 && kept.length === 0) return { ok: false, reason: WHOLE_FACTORY };
  // Put entries must not share a building: a selected member whose twin (the same building by the overlap rule) stays
  // with the source is left out of the new entry; the twin that stays still names the building.
  const taken = new Buildings();
  for (const m of kept) taken.add(m);
  const moved = chosen.filter((m) => !taken.has(m));
  if (moved.length === 0) return { ok: false, reason: NOTHING_SELECTED_IN_FACTORY };
  return checked(
    {
      expect: [{ id: source.id, revision: source.revision }],
      put: [
        { id: source.id, name: source.name, members: kept },
        // ADR-0061: the new factory stays beside its source in the tree (an insert without a parent is top level).
        { name, members: moved, ...(source.parentId == null ? {} : { parentId: source.parentId }) },
      ],
      intent,
    },
    [source],
  );
}

/**
 * Dissolve (Decision 12): the designation goes; its machines return to the automatic reduction. With the whole list
 * (ADR-0061, as the server's DELETE does): its child factories move up to its own parent, and an ancestor left with no
 * machines and no factories goes too, in the same replace.
 */
export function dissolveRequest(source: PlannerDesignation, all: readonly PlannerDesignation[] = [source]): OpResult {
  if (!hasRevision(source)) return { ok: false, reason: NEEDS_NEWER_BACKEND };
  const list = all.some((d) => d.id === source.id) ? all : [...all, source];
  const up = source.parentId ?? null;
  const moves = new Map(list.filter((d) => d.parentId === source.id).map((d) => [d.id, up]));
  return plan(list, { moves, inserts: [], removes: new Set([source.id]) }, "dissolve");
}

// ---- ADR-0061 Decision 6: Group, Ungroup and Move. ----

/** At most this many factories group at once: the new parent is one more `put` entry. */
export const GROUP_MAX = PLANNER_DESIGNATIONS_REPLACE_MAX_PUT - 1;
export const TOO_FEW_TO_GROUP = "Select at least two factories to group.";
export const TOO_MANY_TO_GROUP = `Group up to ${GROUP_MAX} factories at once.`;
export const NOTHING_TO_MOVE = "Pick the factories to move.";
export const ALREADY_THERE = "These factories are already there.";
export const NOTHING_TO_UNGROUP = "There are no factories inside this one to ungroup.";

/** A factory picked to group or move: a designation as read, or an automatic factory's machines (designated as it goes). */
export type HierarchyPick = { designation: PlannerDesignation } | { automatic: { name: string; members: PlannerDesignationMember[] } };

type Put = ReplacePlannerDesignationsRequest["put"][number];

interface Edits {
  /** Designations whose parent changes: id to the new parent (null = top level). */
  moves: ReadonlyMap<string, string | null>;
  /** New designations; a new parent carries its own id so others can name it. */
  inserts: readonly Put[];
  removes: ReadonlySet<string>;
}

/** The name an automatic factory gets when it is designated on the way: its own, or a plain fallback. */
export function designatedName(name: string): string {
  const cut = name.slice(0, 64).trim();
  return nameProblem(cut) === null ? cut : "Factory";
}

/**
 * The replace for a set of tree edits over the whole list, as the server will see it: a designation the edits leave with no
 * machines and no factories is removed too, up the tree (Decision 6: "deleting a parent's last child ... it is deleted in
 * the same replace"); then a cycle or a level past the limit among what the edits touch is a reason, as is an automatic
 * factory whose machines a designation already holds. `expect` names every designation written or removed, at its read
 * revision; the pre-image is those designations as read, which undo restores.
 */
function plan(all: readonly PlannerDesignation[], edits: Edits, intent: ReplaceIntent): OpResult {
  const byId = new Map(all.map((d) => [d.id, d]));
  const rows = new Map<string, { parent: string | null; members: number }>();
  for (const d of all) {
    if (edits.removes.has(d.id)) continue;
    const moved = edits.moves.get(d.id);
    rows.set(d.id, { parent: moved === undefined ? (d.parentId ?? null) : moved, members: d.members.length });
  }
  const insertKey = (p: Put, i: number) => p.id ?? `\u0000new${i}`;
  edits.inserts.forEach((p, i) => rows.set(insertKey(p, i), { parent: p.parentId ?? null, members: p.members.length }));
  const removed = new Set(edits.removes);
  for (let pruned = true; pruned; ) {
    pruned = false;
    const named = new Set([...rows.values()].flatMap((r) => (r.parent === null ? [] : [r.parent])));
    for (const [id, r] of rows) {
      if (r.members > 0 || named.has(id)) continue;
      // Only a designation the edits emptied goes; one that was already empty (bad data) is left as it is.
      const before = byId.get(id);
      if (before === undefined) return { ok: false, reason: SHAPE_TEXT };
      if (!edits.moves.has(id) && !emptiedBy(before, all, edits.moves, removed)) continue;
      rows.delete(id);
      removed.add(id);
      pruned = true;
    }
  }
  // A designation outside the edits still naming a removed one: the page's copy missed a child (the server's 409 stale).
  for (const r of rows.values()) if (r.parent !== null && removed.has(r.parent)) return { ok: false, reason: STALE_TEXT };
  // Cycles and depth, only where the edits reach: an old breach elsewhere never blocks an unrelated change.
  const touched = new Set([...edits.moves.keys(), ...edits.inserts.map(insertKey)]);
  for (const [id, row] of rows) {
    let depth = 1;
    let reached = touched.has(id);
    let cycle = false;
    const seen = new Set([id]);
    for (let p = row.parent; p !== null && rows.has(p); p = rows.get(p)?.parent ?? null) {
      reached ||= touched.has(p);
      if (seen.has(p)) {
        cycle = true;
        break;
      }
      seen.add(p);
      depth += 1;
    }
    if (reached && cycle) return { ok: false, reason: CYCLE_TEXT };
    if (reached && depth > PLANNER_DESIGNATION_MAX_DEPTH) return { ok: false, reason: DEPTH_TEXT };
  }
  // An automatic factory's machines are free buildings; one a designation already holds is the server's 409 overlap.
  const held = all.filter((d) => !removed.has(d.id));
  for (const p of edits.inserts) {
    const other = held.find((d) => sharedBuilding(p.members, d.members) !== undefined);
    if (other !== undefined) return { ok: false, reason: `Some of these machines already belong to ${other.name}` };
  }
  const written = [...edits.moves.keys()].filter((id) => !removed.has(id) && byId.has(id));
  const preImage = [...new Set([...written, ...removed])].flatMap((id) => byId.get(id) ?? []);
  if (!preImage.every(hasRevision)) return { ok: false, reason: NEEDS_NEWER_BACKEND };
  const put: Put[] = [
    ...edits.inserts,
    ...written.flatMap((id): Put[] => {
      const d = byId.get(id);
      return d === undefined ? [] : [{ id, name: d.name, members: d.members, parentId: rows.get(id)?.parent ?? null }];
    }),
  ];
  return checked({ expect: preImage.map((d) => ({ id: d.id, revision: d.revision })), put, intent }, preImage);
}

/** Whether the edits took away a child of a designation that owns no machines (so it may be left with nothing). */
function emptiedBy(d: PlannerDesignation, all: readonly PlannerDesignation[], moves: ReadonlyMap<string, string | null>, removed: ReadonlySet<string>): boolean {
  return d.members.length === 0 && all.some((c) => c.parentId === d.id && (removed.has(c.id) || (moves.has(c.id) && moves.get(c.id) !== d.id)));
}

function picksToEdits(picks: readonly HierarchyPick[], to: string | null): { moves: Map<string, string | null>; inserts: Put[] } {
  const moves = new Map<string, string | null>();
  const inserts: Put[] = [];
  for (const p of picks) {
    if ("designation" in p) moves.set(p.designation.id, to);
    else inserts.push({ name: designatedName(p.automatic.name), members: p.automatic.members, ...(to === null ? {} : { parentId: to }) });
  }
  return { moves, inserts };
}

/**
 * Group: the picked factories go into a new factory (`newId`, named `name`) where they stood (`parentId`, null at the top
 * level). A picked automatic factory is designated in the same replace (owner answer 3), so it is all one change.
 */
export function groupRequest({
  all,
  picks,
  name,
  parentId,
  newId,
}: {
  all: readonly PlannerDesignation[];
  picks: readonly HierarchyPick[];
  name: string;
  parentId: string | null;
  newId: string;
}): OpResult {
  // The same designation picked twice is one factory, not a group.
  const seen = new Set<string>();
  picks = picks.filter((p) => !("designation" in p) || (!seen.has(p.designation.id) && seen.add(p.designation.id)));
  if (picks.length < 2) return { ok: false, reason: TOO_FEW_TO_GROUP };
  if (picks.length > GROUP_MAX) return { ok: false, reason: TOO_MANY_TO_GROUP };
  const { moves, inserts } = picksToEdits(picks, newId);
  const parent: Put = { id: newId, name, members: [], ...(parentId === null ? {} : { parentId }) };
  return plan(all, { moves, inserts: [parent, ...inserts], removes: new Set() }, "group");
}

/**
 * Ungroup: a parent's factories move up to its own parent (or the top level). A parent that owns machines stays, as a
 * factory of those machines in the same place; one that owns none goes in the same replace.
 */
export function ungroupRequest({ all, parent }: { all: readonly PlannerDesignation[]; parent: PlannerDesignation }): OpResult {
  const children = all.filter((d) => d.parentId === parent.id);
  if (children.length === 0) return { ok: false, reason: NOTHING_TO_UNGROUP };
  const up = parent.parentId ?? null;
  const moves = new Map(children.map((d) => [d.id, up]));
  return plan(all, { moves, inserts: [], removes: parent.members.length === 0 ? new Set([parent.id]) : new Set() }, "ungroup");
}

/**
 * Move: the picked factories go into `to` (a designation, which then has factories in it) or to the top level (null). A
 * picked automatic factory is designated there. A parent the move empties goes in the same replace.
 */
export function moveRequest({ all, picks, to }: { all: readonly PlannerDesignation[]; picks: readonly HierarchyPick[]; to: string | null }): OpResult {
  if (picks.length === 0) return { ok: false, reason: NOTHING_TO_MOVE };
  if (picks.length > PLANNER_DESIGNATIONS_REPLACE_MAX_PUT) return { ok: false, reason: `Move up to ${PLANNER_DESIGNATIONS_REPLACE_MAX_PUT} factories at once.` };
  if (picks.every((p) => "designation" in p && (p.designation.parentId ?? null) === to)) return { ok: false, reason: ALREADY_THERE };
  const { moves, inserts } = picksToEdits(picks, to);
  return plan(all, { moves, inserts, removes: new Set() }, "move");
}

export interface MoveTarget {
  /** null = the top level. */
  id: string | null;
  /** The path to it by name, root first ("Main base / Smelters"), or "Top level". */
  label: string;
}

export const TOP_LEVEL = "Top level";

/**
 * Where the picked factories can move: the top level and every designation a move would be accepted into (not one of
 * them or inside one, not past the depth limit), except `from`, where they already are. By path name.
 */
export function moveTargets(all: readonly PlannerDesignation[], picks: readonly HierarchyPick[], from: string | null): MoveTarget[] {
  const byId = new Map(all.map((d) => [d.id, d]));
  const pathName = (d: PlannerDesignation): string => {
    const names = [d.name];
    const seen = new Set([d.id]);
    for (let p = d.parentId ?? null; p !== null && !seen.has(p); p = byId.get(p)?.parentId ?? null) {
      const up = byId.get(p);
      if (up === undefined) break;
      seen.add(p);
      names.unshift(up.name);
    }
    return names.join(" / ");
  };
  const targets: MoveTarget[] = [];
  if (from !== null && moveRequest({ all, picks, to: null }).ok) targets.push({ id: null, label: TOP_LEVEL });
  const named = all
    .filter((d) => d.id !== from && moveRequest({ all, picks, to: d.id }).ok)
    .map((d) => ({ id: d.id, label: pathName(d) }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  // Names need not be unique: a repeated path gets its place in the list, so no two choices read alike.
  const seen = new Map<string, number>();
  const told = named.map((t) => {
    const n = (seen.get(t.label) ?? 0) + 1;
    seen.set(t.label, n);
    return n === 1 ? t : { ...t, label: `${t.label} (${n})` };
  });
  return [...targets, ...told];
}

/**
 * Undo ("Split back" after a merge): the inverse of a replace, from the pre-image the client read and the response's
 * written designations. `expect` = each written one at the revision the response returned (the removed ones are gone
 * already); `put` = the originals with their ids, `createdAt` and stored members in their original order, never the
 * matcher's building ids. Put entries must not share a building, so where the originals overlapped, the older keeps the
 * building (as matching does); a designation left with no member at all cannot be restored and is left out, unless it had
 * none to begin with (ADR-0061: a parent, restored with its factories). The parent goes back explicitly, `parentId` null
 * for the top level: on an update in place an absent one would keep the parent the change gave it. A pre-image read from
 * a backend without nesting has no `parentId` and sends none.
 */
export function undoRequest(preImage: readonly PlannerDesignation[], result: ReplacePlannerDesignationsResponse): OpResult {
  const taken = new Buildings();
  const put: ReplacePlannerDesignationsRequest["put"] = [];
  for (const d of oldestFirst(preImage)) {
    const members = d.members.filter((m) => !taken.has(m));
    for (const m of members) taken.add(m);
    if (members.length > 0 || d.members.length === 0) {
      put.push({ id: d.id, name: d.name, members, createdAt: d.createdAt, ...(d.parentId === undefined ? {} : { parentId: d.parentId }) });
    }
  }
  const expect = result.designations.map((d) => ({ id: d.id, revision: d.revision }));
  if (expect.length === 0 && put.length === 0) return { ok: false, reason: NOTHING_TO_UNDO };
  return checked({ expect, put, intent: "undo" }, []);
}
