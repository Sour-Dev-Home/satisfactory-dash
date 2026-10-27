import {
  PLANNER_DESIGNATIONS_MAX_PER_SERVER,
  type PlannerDesignation,
  type PlannerDesignationMember,
  type ReplacePlannerDesignationsRequest,
  type ReplacePlannerDesignationsResponse,
} from "@satisfactory-dash/shared";
import { sharedBuilding } from "../planner/designationOps";

/**
 * The demo's designations, kept in memory for the page's life (ADR-0026: no network, nothing saved). The writes follow
 * the backend's rules (ADR-0055 Decisions 5 and 11) closely enough that the demo shows merge, split, pop-out, dissolve and
 * undo working, and the stale, overlap and cap answers: a pure function over a list, so it is tested on its own.
 */

export type StoredDesignation = PlannerDesignation & { revision: number };

export type WriteFailure = {
  ok: false;
  status: 400 | 404 | 409;
  code: "bad_request" | "not_found" | "designation_stale" | "designation_overlap" | "designation_cap";
  message: string;
  other?: { id: string; name: string };
};

export type ReplaceOutcome = { ok: true; next: StoredDesignation[]; response: ReplacePlannerDesignationsResponse } | WriteFailure;

const oldestFirst = (list: StoredDesignation[]) =>
  list.map((d, i) => ({ d, i })).sort((a, b) => Date.parse(a.d.createdAt) - Date.parse(b.d.createdAt) || a.i - b.i).map((x) => x.d);

/** The first designation in `list` holding one of `members`' buildings, as a 409 `designation_overlap`. */
function overlapWith(list: readonly StoredDesignation[], members: readonly PlannerDesignationMember[]): WriteFailure | null {
  const other = list.find((d) => sharedBuilding(members, d.members) !== undefined);
  return other === undefined
    ? null
    : { ok: false, status: 409, code: "designation_overlap", message: "A building in this designation already belongs to another designation.", other: { id: other.id, name: other.name } };
}

const STALE: WriteFailure = { ok: false, status: 409, code: "designation_stale", message: "One of these designations was changed by someone else" };
const CAP: WriteFailure = { ok: false, status: 409, code: "designation_cap", message: "Too many designations" };

/**
 * One replace (Decision 11): every `expect` must exist at its revision; a `put` naming an expected id updates it in place
 * (kept `createdAt`, revision + 1), any other is inserted (keeping a given id and `createdAt`); an expected id no `put`
 * names is removed. The body has passed the contract's schema already (the demo transport parses it).
 */
export function applyReplace(
  current: readonly StoredDesignation[],
  body: ReplacePlannerDesignationsRequest,
  now: number,
  newId: () => string,
): ReplaceOutcome {
  const byId = new Map(current.map((d) => [d.id, d]));
  for (const e of body.expect) if (byId.get(e.id)?.revision !== e.revision) return STALE;
  if (body.put.some((p) => p.createdAt !== undefined && Date.parse(p.createdAt) > now)) {
    return { ok: false, status: 400, code: "bad_request", message: "A creation time is in the future" };
  }
  const expected = new Set(body.expect.map((e) => e.id));
  const rest = current.filter((d) => !expected.has(d.id));
  if (body.put.some((p) => p.id !== undefined && !expected.has(p.id) && rest.some((d) => d.id === p.id))) return STALE;
  for (const p of body.put) {
    const overlap = overlapWith(rest, p.members);
    if (overlap !== null) return overlap;
  }
  if (rest.length + body.put.length > PLANNER_DESIGNATIONS_MAX_PER_SERVER) return CAP;
  const stamp = new Date(now).toISOString();
  const written: StoredDesignation[] = body.put.map((p) => {
    const before = p.id === undefined ? undefined : byId.get(p.id);
    if (before !== undefined && expected.has(before.id)) {
      return { ...before, name: p.name, members: [...p.members], updatedAt: stamp, revision: before.revision + 1 };
    }
    return { id: p.id ?? newId(), name: p.name, mode: "core", members: [...p.members], createdAt: p.createdAt ?? stamp, updatedAt: stamp, revision: 1 };
  });
  const kept = new Set(written.map((d) => d.id));
  return {
    ok: true,
    next: oldestFirst([...rest, ...written]),
    response: { designations: written, removedIds: body.expect.map((e) => e.id).filter((id) => !kept.has(id)) },
  };
}

export type SingleOutcome = { ok: true; next: StoredDesignation[]; designation: StoredDesignation } | WriteFailure;

/** POST: a new designation, refused when it overlaps another or the server already has the most it may. */
export function applyCreate(current: readonly StoredDesignation[], body: { name: string; members: PlannerDesignationMember[] }, now: number, newId: () => string): SingleOutcome {
  const overlap = overlapWith(current, body.members);
  if (overlap !== null) return overlap;
  if (current.length >= PLANNER_DESIGNATIONS_MAX_PER_SERVER) return CAP;
  const stamp = new Date(now).toISOString();
  const designation: StoredDesignation = { id: newId(), name: body.name, mode: "core", members: [...body.members], createdAt: stamp, updatedAt: stamp, revision: 1 };
  return { ok: true, next: [...current, designation], designation };
}

/** PUT: a rename and/or new members, revision + 1. */
export function applyUpdate(
  current: readonly StoredDesignation[],
  id: string,
  body: { name?: string | undefined; members?: PlannerDesignationMember[] | undefined },
  now: number,
): SingleOutcome {
  const before = current.find((d) => d.id === id);
  if (before === undefined) return { ok: false, status: 404, code: "not_found", message: "No such designation" };
  if (body.members !== undefined) {
    const overlap = overlapWith(
      current.filter((d) => d.id !== id),
      body.members,
    );
    if (overlap !== null) return overlap;
  }
  const designation: StoredDesignation = {
    ...before,
    name: body.name ?? before.name,
    members: body.members === undefined ? before.members : [...body.members],
    updatedAt: new Date(now).toISOString(),
    revision: before.revision + 1,
  };
  return { ok: true, next: current.map((d) => (d.id === id ? designation : d)), designation };
}

/** DELETE. */
export function applyRemove(current: readonly StoredDesignation[], id: string): { ok: true; next: StoredDesignation[] } | WriteFailure {
  if (!current.some((d) => d.id === id)) return { ok: false, status: 404, code: "not_found", message: "No such designation" };
  return { ok: true, next: current.filter((d) => d.id !== id) };
}
