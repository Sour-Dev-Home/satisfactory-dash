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
import { findOverlap } from "../services/designationMatching.js";

/**
 * ADR-0055 Decision 5: `map.factory_designations`, a player's named sets of buildings. Servers are addressed by their PUBLIC
 * id, joined to the internal uuid here (same convention as worldLayerRepository.ts). No user id is stored; every write
 * records an audit event (ids and counts only, never the name). Every SQL text is a constant.
 *
 * RACES. Every write takes the server row `FOR NO KEY UPDATE` first, so two writes to one server's designations run one
 * after the other: the cap check and the overlap check each see the other's commit. (Foreign keys only take FOR KEY SHARE
 * on that row, which this does not block.)
 */

/** The port the routes use. The database implementation is below; tests use a stand-in. */
export interface DesignationStore {
  /** Oldest first. A server that is gone has none. */
  list(serverId: string): Promise<PlannerDesignation[]>;
  create(serverId: string, input: { userId: string; name: string; mode: "core"; members: PlannerDesignationMember[] }): Promise<CreateOutcome>;
  update(serverId: string, designationId: string, input: { userId: string; name?: string; members?: PlannerDesignationMember[] }): Promise<UpdateOutcome>;
  /** False when there is no such designation on this server. */
  remove(serverId: string, designationId: string, userId: string): Promise<boolean>;
}

export type OverlapOutcome = { kind: "overlap"; other: { id: string; name: string } };
export type CreateOutcome = { kind: "created"; designation: PlannerDesignation } | { kind: "cap" } | { kind: "no_server" } | OverlapOutcome;
export type UpdateOutcome = { kind: "updated"; designation: PlannerDesignation } | { kind: "not_found" } | { kind: "no_server" } | OverlapOutcome;

const RowSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: PlannerDesignationModeSchema,
  members: z.array(PlannerDesignationMemberSchema),
  created_at: z.union([z.string(), z.date()]),
  updated_at: z.union([z.string(), z.date()]),
});

const iso = (value: string | Date): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

function toDesignation(row: z.output<typeof RowSchema>): PlannerDesignation {
  return { id: row.id, name: row.name, mode: row.mode, members: row.members, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

const SELECT_ALL = `
  SELECT d.id, d.name, d.mode, d.members, d.created_at, d.updated_at
  FROM map.factory_designations d
  JOIN servers.servers s ON s.id = d.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ORDER BY d.created_at, d.id`;

const LOCK_SERVER = `
  SELECT s.id FROM servers.servers s
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  FOR NO KEY UPDATE`;

const SELECT_FOR_SERVER = `
  SELECT id, name, mode, members, created_at, updated_at
  FROM map.factory_designations
  WHERE server_id = $1
  ORDER BY created_at, id`;

const INSERT = `
  INSERT INTO map.factory_designations (server_id, name, mode, members)
  VALUES ($1, $2, $3, $4::jsonb)
  RETURNING id, name, mode, members, created_at, updated_at`;

const UPDATE = `
  UPDATE map.factory_designations
  SET name = $3, members = $4::jsonb, updated_at = now()
  WHERE server_id = $1 AND id = $2
  RETURNING id, name, mode, members, created_at, updated_at`;

const DELETE = `
  DELETE FROM map.factory_designations
  WHERE server_id = $1 AND id = $2
  RETURNING id`;

type Tx = Parameters<Parameters<typeof withTransaction>[1]>[0];

async function lockServer(client: Tx, publicId: string): Promise<string | undefined> {
  const result = await timedQuery(client, "map.designations.lockServer", LOCK_SERVER, [publicId]);
  return parseFirst(z.object({ id: z.string() }), result.rows, "map.designations.lockServer")?.id;
}

async function readAll(client: Tx, serverUuid: string): Promise<PlannerDesignation[]> {
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
        const inserted = await timedQuery(client, "map.designations.insert", INSERT, [serverUuid, input.name, input.mode, JSON.stringify(input.members)]);
        const designation = toDesignation(parseFirst(RowSchema, inserted.rows, "map.designations.insert") ?? failInsert());
        await recordAuditEvent(client, {
          action: "planner.designation_created",
          actorUserId: input.userId,
          serverId: serverUuid,
          detail: { designationId: designation.id, members: input.members.length },
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
        const result = await timedQuery(client, "map.designations.delete", DELETE, [serverUuid, designationId]);
        if (result.rows.length === 0) return false;
        await recordAuditEvent(client, { action: "planner.designation_deleted", actorUserId: userId, serverId: serverUuid, detail: { designationId } });
        return true;
      }),
  };
}

function failInsert(): never {
  throw new Error("map.factory_designations write returned no row");
}
