import { z } from "zod";
import {
  PLANNER_DESIGNATIONS_MAX_PER_SERVER,
  PlannerDesignationMemberSchema,
  PlannerDesignationModeSchema,
} from "@satisfactory-dash/shared";
import type { PlannerDesignation, PlannerDesignationMember } from "@satisfactory-dash/shared";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import { parseFirst, parseRows } from "../../../platform/db/rows.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { checkHierarchy, emptiedAncestors, parentsFirst, untouchedBreaches } from "../services/designationHierarchy.js";
import type { HierarchyBreach, HierarchyNode } from "../services/designationHierarchy.js";
import { findOverlap } from "../services/designationMatching.js";

/**
 * ADR-0055 Decision 5: `map.factory_designations`, a player's named sets of buildings. Servers are addressed by their PUBLIC
 * id, joined to the internal uuid here (same convention as worldLayerRepository.ts). No user id is stored; every write
 * records an audit event (ids and counts only, never the name). Every SQL text is a constant.
 *
 * RACES. Every write takes the server row `FOR NO KEY UPDATE` first, so two writes to one server's designations run one
 * after the other: the cap check and the overlap check each see the other's commit. (Foreign keys only take FOR KEY SHARE
 * on that row, which this does not block.)
 *
 * REPLACE (ADR-0055 amendment 2026-10-27, Decision 11): merge, split, dissolve and undo in one transaction under the same
 * lock. It checks every precondition (revisions, overlap with the designations outside `expect`, the cap on the resulting
 * set) against the locked rows before it writes anything, so a refusal changes nothing. Every write bumps `revision`.
 *
 * HIERARCHY (ADR-0061). `parent_id` (same server, ON DELETE RESTRICT) nests a designation. Create and replace check the
 * resulting set with `checkHierarchy` under the same lock (a missing parent is `stale`, then `cycle`, `depth`, `shape`),
 * so a parent deleted by a concurrent write is seen as gone, never as a foreign-key error. A replace writes inserts
 * parents first, then updates in place, then deletes, so the foreign key holds after every statement. DELETE of a
 * designation moves its children up to its own parent (ADR-0061 Decision 6's ungroup) and then deletes each ancestor left
 * with no members and no children (Decision 6: "otherwise it is deleted in the same replace"), all in one transaction.
 */

/** The port the routes use. The database implementation is below; tests use a stand-in. */
export interface DesignationStore {
  /** Oldest first. A server that is gone has none. */
  list(serverId: string): Promise<PlannerDesignation[]>;
  create(serverId: string, input: CreateInput): Promise<CreateOutcome>;
  /** Never changes the parent (ADR-0061 Contracts 2). */
  update(serverId: string, designationId: string, input: { userId: string; name?: string; members?: PlannerDesignationMember[] }): Promise<UpdateOutcome>;
  /** False when there is no such designation on this server. Its children move up to its parent; ancestors left empty go. */
  remove(serverId: string, designationId: string, userId: string): Promise<boolean>;
  /** ADR-0055 Decision 11: resulting set = existing, minus the `expect` ids, plus the `put` entries; all or nothing. */
  replace(serverId: string, input: ReplaceInput): Promise<ReplaceOutcome>;
}

export interface CreateInput {
  userId: string;
  name: string;
  mode: "core";
  members: PlannerDesignationMember[];
  /** ADR-0061: absent or null = top level. */
  parentId?: string | null;
}

export interface ReplaceInput {
  userId: string;
  expect: readonly { id: string; revision: number }[];
  /** `parentId` (ADR-0061): on an insert absent or null = top level; on an update in place absent = unchanged. */
  put: readonly { id?: string; name: string; members: PlannerDesignationMember[]; createdAt?: string; parentId?: string | null }[];
  /** An audit hint only; behaviour never depends on it. */
  intent?: string;
}

export type OverlapOutcome = { kind: "overlap"; other: { id: string; name: string } };
/** ADR-0061: the resulting tree breaks a rule (see designationHierarchy.ts). `stale` = a parent that is not there. */
export type HierarchyOutcome = HierarchyBreach;
export type CreateOutcome = { kind: "created"; designation: PlannerDesignation } | { kind: "cap" } | { kind: "no_server" } | OverlapOutcome | HierarchyOutcome;
export type UpdateOutcome = { kind: "updated"; designation: PlannerDesignation } | { kind: "not_found" } | { kind: "no_server" } | OverlapOutcome;
/** A replace's designations always carry `revision` (the contract requires it on the response). */
export type RevisedDesignation = PlannerDesignation & { revision: number };
export type ReplaceOutcome =
  | { kind: "replaced"; designations: RevisedDesignation[]; removedIds: string[] }
  | { kind: "no_server" }
  /** An `expect` entry is gone or at another revision, or an inserted `id` still exists: the client's view is old. The ids
   *  are for the caller's tests and logs; the error envelope does not carry them. */
  | { kind: "stale"; ids: string[] }
  /** A `put` entry's `createdAt` is in the future (400: a client bug, the schema cannot know the time). */
  | { kind: "created_in_future" }
  | { kind: "cap" }
  | OverlapOutcome
  | Exclude<HierarchyOutcome, { kind: "stale" }>;

const RowSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: PlannerDesignationModeSchema,
  members: z.array(PlannerDesignationMemberSchema),
  created_at: z.union([z.string(), z.date()]),
  updated_at: z.union([z.string(), z.date()]),
  revision: z.number().int(),
  parent_id: z.string().nullable(),
});

const iso = (value: string | Date): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/** A replace's and a create's designations always carry `parentId` (null = top level). */
export type StoredDesignation = RevisedDesignation & { parentId: string | null };

function toDesignation(row: z.output<typeof RowSchema>): StoredDesignation {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    members: row.members,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    revision: row.revision,
    parentId: row.parent_id,
  };
}

const nodeOf = (d: StoredDesignation): HierarchyNode => ({ id: d.id, parentId: d.parentId, memberCount: d.members.length });

const SELECT_ALL = `
  SELECT d.id, d.name, d.mode, d.members, d.created_at, d.updated_at, d.revision, d.parent_id
  FROM map.factory_designations d
  JOIN servers.servers s ON s.id = d.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ORDER BY d.created_at, d.id`;

const LOCK_SERVER = `
  SELECT s.id FROM servers.servers s
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  FOR NO KEY UPDATE`;

const SELECT_FOR_SERVER = `
  SELECT id, name, mode, members, created_at, updated_at, revision, parent_id
  FROM map.factory_designations
  WHERE server_id = $1
  ORDER BY created_at, id`;

// `created_at` in whole milliseconds, the precision the API returns, so an undo that sends it back restores it exactly
// (and so the matching order, which sorts by it). Rows written before this keep their microseconds.
const INSERT = `
  INSERT INTO map.factory_designations (server_id, name, mode, members, created_at, parent_id)
  VALUES ($1, $2, $3, $4::jsonb, date_trunc('milliseconds', now()), $5::uuid)
  RETURNING id, name, mode, members, created_at, updated_at, revision, parent_id`;

// Every write to a row bumps its revision (Decision 11), the single update and a replace's update in place alike.
const UPDATE = `
  UPDATE map.factory_designations
  SET name = $3, members = $4::jsonb, updated_at = now(), revision = revision + 1
  WHERE server_id = $1 AND id = $2
  RETURNING id, name, mode, members, created_at, updated_at, revision, parent_id`;

/** A replace's update in place (ADR-0061): the parent is written too, already resolved (absent = the current one). */
const UPDATE_IN_PLACE = `
  UPDATE map.factory_designations
  SET name = $3, members = $4::jsonb, parent_id = $5::uuid, updated_at = now(), revision = revision + 1
  WHERE server_id = $1 AND id = $2
  RETURNING id, name, mode, members, created_at, updated_at, revision, parent_id`;

/** DELETE of a parent (ADR-0061): its children move up to its own parent. A write to each child, so revision + 1. */
const REPARENT_CHILDREN = `
  UPDATE map.factory_designations
  SET parent_id = $3::uuid, updated_at = now(), revision = revision + 1
  WHERE server_id = $1 AND parent_id = $2
  RETURNING id`;

const DELETE = `
  DELETE FROM map.factory_designations
  WHERE server_id = $1 AND id = $2
  RETURNING id`;

const DELETE_MANY = `
  DELETE FROM map.factory_designations
  WHERE server_id = $1 AND id = ANY($2::uuid[])
  RETURNING id`;

/** A replace's insert: an undo restores the original id and creation time (so the matching priority), else new ones. */
const INSERT_RESTORING = `
  INSERT INTO map.factory_designations (server_id, id, name, mode, members, created_at, parent_id)
  VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3, 'core', $4::jsonb, COALESCE($5::timestamptz, date_trunc('milliseconds', now())), $6::uuid)
  RETURNING id, name, mode, members, created_at, updated_at, revision, parent_id`;

type Tx = Parameters<Parameters<typeof withTransaction>[1]>[0];

async function lockServer(client: Tx, publicId: string): Promise<string | undefined> {
  const result = await timedQuery(client, "map.designations.lockServer", LOCK_SERVER, [publicId]);
  return parseFirst(z.object({ id: z.string() }), result.rows, "map.designations.lockServer")?.id;
}

async function readAll(client: Tx, serverUuid: string): Promise<StoredDesignation[]> {
  const result = await timedQuery(client, "map.designations.readAll", SELECT_FOR_SERVER, [serverUuid]);
  return parseRows(RowSchema, result.rows, "map.designations.readAll").map(toDesignation);
}

export function createDbDesignationStore(db: Queryable & Parameters<typeof withTransaction>[0]): DesignationStore {
  return {
    async list(serverId) {
      const result = await timedQuery(db, "map.designations.list", SELECT_ALL, [serverId]);
      return parseRows(RowSchema, result.rows, "map.designations.list").map(toDesignation);
    },

    create: (serverId, input) =>
      withTransaction(db, async (client): Promise<CreateOutcome> => {
        const serverUuid = await lockServer(client, serverId);
        if (serverUuid === undefined) return { kind: "no_server" };
        const existing = await readAll(client, serverUuid);
        if (existing.length >= PLANNER_DESIGNATIONS_MAX_PER_SERVER) return { kind: "cap" };
        const other = findOverlap(input.members, existing);
        if (other !== undefined) return { kind: "overlap", other };
        // ADR-0061: the new one has no children, so an empty one is `shape`; "" stands in for its id (never a uuid).
        const parentId = input.parentId ?? null;
        const before = existing.map(nodeOf);
        const breach = checkHierarchy([...before, { id: "", parentId, memberCount: input.members.length }], untouchedBreaches(before, []));
        if (breach !== undefined) return breach;
        const inserted = await timedQuery(client, "map.designations.insert", INSERT, [serverUuid, input.name, input.mode, JSON.stringify(input.members), parentId]);
        const designation = toDesignation(parseFirst(RowSchema, inserted.rows, "map.designations.insert") ?? failInsert());
        await recordAuditEvent(client, {
          action: "planner.designation_created",
          actorUserId: input.userId,
          serverId: serverUuid,
          detail: { designationId: designation.id, members: input.members.length, ...(parentId !== null && { parentId }) },
        });
        return { kind: "created", designation };
      }),

    update: (serverId, designationId, input) =>
      withTransaction(db, async (client): Promise<UpdateOutcome> => {
        const serverUuid = await lockServer(client, serverId);
        if (serverUuid === undefined) return { kind: "no_server" };
        const existing = await readAll(client, serverUuid);
        const current = existing.find((d) => d.id === designationId);
        if (current === undefined) return { kind: "not_found" };
        if (input.members !== undefined) {
          const other = findOverlap(input.members, existing.filter((d) => d.id !== designationId));
          if (other !== undefined) return { kind: "overlap", other };
        }
        const members = input.members ?? current.members;
        const updated = await timedQuery(client, "map.designations.update", UPDATE, [serverUuid, designationId, input.name ?? current.name, JSON.stringify(members)]);
        const designation = toDesignation(parseFirst(RowSchema, updated.rows, "map.designations.update") ?? failInsert());
        await recordAuditEvent(client, {
          action: "planner.designation_updated",
          actorUserId: input.userId,
          serverId: serverUuid,
          detail: { designationId, members: members.length, renamed: input.name !== undefined, membersChanged: input.members !== undefined },
        });
        return { kind: "updated", designation };
      }),

    remove: (serverId, designationId, userId) =>
      withTransaction(db, async (client) => {
        const serverUuid = await lockServer(client, serverId);
        if (serverUuid === undefined) return false;
        const existing = await readAll(client, serverUuid);
        const target = existing.find((d) => d.id === designationId);
        if (target === undefined) return false;
        // ADR-0061: the children move up a level first (the foreign key restricts deleting a parent), as an ungroup does.
        const children = existing.filter((d) => d.parentId === designationId);
        if (children.length > 0) await timedQuery(client, "map.designations.reparentChildren", REPARENT_CHILDREN, [serverUuid, designationId, target.parentId]);
        await timedQuery(client, "map.designations.delete", DELETE, [serverUuid, designationId]);
        // A parent left with no members and no children is not allowed (Decision 1): it goes too, and so up the tree.
        const removedParentIds = children.length > 0 ? [] : emptiedAncestors(existing.map(nodeOf), designationId);
        for (const id of removedParentIds) await timedQuery(client, "map.designations.delete", DELETE, [serverUuid, id]);
        await recordAuditEvent(client, {
          action: "planner.designation_deleted",
          actorUserId: userId,
          serverId: serverUuid,
          detail: {
            designationId,
            ...(children.length > 0 && { reparentedIds: children.map((d) => d.id) }),
            ...(removedParentIds.length > 0 && { removedParentIds }),
          },
        });
        return true;
      }),

    replace: (serverId, input) => {
      // The schema cannot know the time; a restored creation time from the future would jump the matching priority queue.
      const now = Date.now();
      if (input.put.some((p) => p.createdAt !== undefined && Date.parse(p.createdAt) > now)) return Promise.resolve({ kind: "created_in_future" });
      return withTransaction(db, async (client): Promise<ReplaceOutcome> => {
        const serverUuid = await lockServer(client, serverId);
        if (serverUuid === undefined) return { kind: "no_server" };
        const existing = await readAll(client, serverUuid);
        const byId = new Map(existing.map((d) => [d.id, d] as const));
        const expectIds = new Set(input.expect.map((e) => e.id));

        // Preconditions: every expected designation is still there at the revision the client read, and no inserted id is
        // still taken (it is not expected, so it survives the removal). Either means the client's view is old.
        const stale = input.expect.filter((e) => byId.get(e.id)?.revision !== e.revision).map((e) => e.id);
        for (const p of input.put) if (p.id !== undefined && !expectIds.has(p.id) && byId.has(p.id)) stale.push(p.id);
        if (stale.length > 0) return { kind: "stale", ids: stale };

        // The resulting set = the designations outside `expect` plus the put entries (which the schema keeps disjoint).
        const outside = existing.filter((d) => !expectIds.has(d.id));
        for (const p of input.put) {
          const other = findOverlap(p.members, outside);
          if (other !== undefined) return { kind: "overlap", other };
        }
        if (outside.length + input.put.length > PLANNER_DESIGNATIONS_MAX_PER_SERVER) return { kind: "cap" };

        // ADR-0061: the resulting tree. An update in place without `parentId` keeps its parent; an insert without one is top
        // level. An insert without an id gets a stand-in no other entry can name (not a uuid). A designation outside
        // `expect` whose parent this replace removes names a parent that is gone: `stale` (the client missed a child).
        const planned = input.put.map((p, index) => {
          const current = p.id !== undefined && expectIds.has(p.id) ? byId.get(p.id) : undefined;
          const parentId = current !== undefined && p.parentId === undefined ? current.parentId : (p.parentId ?? null);
          return { put: p, index, inPlace: current !== undefined, id: p.id ?? `new:${index}`, parentId };
        });
        const after = [...outside.map(nodeOf), ...planned.map((w) => ({ id: w.id, parentId: w.parentId, memberCount: w.put.members.length }))];
        const breach = checkHierarchy(after, untouchedBreaches(existing.map(nodeOf), planned.map((w) => w.id)));
        if (breach !== undefined) return breach;

        const putIds = new Set(input.put.flatMap((p) => (p.id === undefined ? [] : [p.id])));
        const removedIds = input.expect.filter((e) => !putIds.has(e.id)).map((e) => e.id);

        // The foreign key holds after every statement: inserts parents first, then updates in place (every parent they name
        // now exists), then deletes (nothing left names a removed designation; the check above refused that).
        const written = new Map<number, StoredDesignation>();
        for (const w of parentsFirst(planned.filter((x) => !x.inPlace))) {
          const params = [serverUuid, w.put.id ?? null, w.put.name, JSON.stringify(w.put.members), w.put.createdAt ?? null, w.parentId];
          const inserted = await timedQuery(client, "map.designations.insertRestoring", INSERT_RESTORING, params);
          written.set(w.index, toDesignation(parseFirst(RowSchema, inserted.rows, "map.designations.insertRestoring") ?? failInsert()));
        }
        for (const w of planned.filter((x) => x.inPlace)) {
          // In place: kept id and createdAt, revision + 1 (a createdAt sent for it is ignored).
          const updated = await timedQuery(client, "map.designations.update", UPDATE_IN_PLACE, [serverUuid, w.id, w.put.name, JSON.stringify(w.put.members), w.parentId]);
          written.set(w.index, toDesignation(parseFirst(RowSchema, updated.rows, "map.designations.update") ?? failInsert()));
        }
        if (removedIds.length > 0) await timedQuery(client, "map.designations.deleteMany", DELETE_MANY, [serverUuid, removedIds]);

        const designations = planned.map((w) => written.get(w.index) ?? failInsert());
        const updatedIds = planned.filter((w) => w.inPlace).map((w) => w.id);
        const addedIds = planned.filter((w) => !w.inPlace).map((w) => (written.get(w.index) ?? failInsert()).id);
        // One event per call, ids and counts only (never a name), as Decision 5.
        await recordAuditEvent(client, {
          action: "planner.designations_replaced",
          actorUserId: input.userId,
          serverId: serverUuid,
          detail: {
            ...(input.intent !== undefined && { intent: input.intent }),
            removedIds,
            updatedIds,
            addedIds,
            members: input.put.reduce((sum, p) => sum + p.members.length, 0),
          },
        });
        return { kind: "replaced", designations, removedIds };
      });
    },
  };
}

function failInsert(): never {
  throw new Error("map.factory_designations write returned no row");
}
