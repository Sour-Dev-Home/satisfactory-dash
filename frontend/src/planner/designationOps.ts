import {
  PLANNER_DESIGNATION_MAX_MEMBERS,
  PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT,
  ReplacePlannerDesignationsRequestSchema,
  type PlannerDesignation,
  type PlannerDesignationMember,
  type PlannerNode,
  type ReplacePlannerDesignationsRequest,
  type ReplacePlannerDesignationsResponse,
} from "@satisfactory-dash/shared";
import { Buildings } from "./buildingOverlap";
import { nameProblem } from "./designationText";

/**
 * ADR-0055 Decisions 11 and 12 (#727): the replace requests for merge, split, pop-out, dissolve and undo, built from what
 * the page shows. Pure: no React, no network. Each builder answers the request plus the pre-image (the designations as
 * they were read, which undo restores), or the reason it cannot be sent. The server re-checks everything; these checks
 * only keep a request the server would refuse from being sent.
 */

export type ReplaceIntent = "merge" | "split" | "pop_out" | "dissolve" | "undo";

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
        { name, members: moved },
      ],
      intent,
    },
    [source],
  );
}

/** Dissolve (Decision 12): the designation goes; its machines return to the automatic reduction. */
export function dissolveRequest(source: PlannerDesignation): OpResult {
  if (!hasRevision(source)) return { ok: false, reason: NEEDS_NEWER_BACKEND };
  return checked({ expect: [{ id: source.id, revision: source.revision }], put: [], intent: "dissolve" }, [source]);
}

/**
 * Undo ("Split back" after a merge): the inverse of a replace, from the pre-image the client read and the response's
 * written designations. `expect` = each written one at the revision the response returned (the removed ones are gone
 * already); `put` = the originals with their ids, `createdAt` and stored members in their original order, never the
 * matcher's building ids. Put entries must not share a building, so where the originals overlapped, the older keeps the
 * building (as matching does); a designation left with no member at all cannot be restored and is left out.
 */
export function undoRequest(preImage: readonly PlannerDesignation[], result: ReplacePlannerDesignationsResponse): OpResult {
  const taken = new Buildings();
  const put: ReplacePlannerDesignationsRequest["put"] = [];
  for (const d of oldestFirst(preImage)) {
    const members = d.members.filter((m) => !taken.has(m));
    for (const m of members) taken.add(m);
    if (members.length > 0) put.push({ id: d.id, name: d.name, members, createdAt: d.createdAt });
  }
  const expect = result.designations.map((d) => ({ id: d.id, revision: d.revision }));
  if (expect.length === 0 && put.length === 0) return { ok: false, reason: NOTHING_TO_UNDO };
  return checked({ expect, put, intent: "undo" }, []);
}
