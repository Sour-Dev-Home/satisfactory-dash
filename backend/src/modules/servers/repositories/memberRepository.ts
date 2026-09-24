import { z } from "zod";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  uniqueViolationConstraint,
} from "../../../platform/db/errors.js";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import type { MemberRole } from "./serverRepository.js";

/**
 * Server memberships (ADR-0020, ADR-0025 decision "authorization"). The rules live in the
 * database: primary key (server, user), a role check, and a partial unique index that allows at
 * most one owner per server. Every lookup scopes by user AND resolves the server by its public
 * id in the same query, so a caller cannot ask about a server without stating who is asking.
 */
const ONE_OWNER_INDEX = "server_members_one_owner";
const MEMBER_PKEY = "server_members_pkey";

const RoleRowSchema = z.object({ role: z.enum(["owner", "admin", "viewer"]) });

const SELECT_ROLE = `
  SELECT m.role
  FROM servers.server_members m
  JOIN servers.servers s ON s.id = m.server_id
  WHERE s.public_id = $1 AND m.user_id = $2 AND s.deleted_at IS NULL`;

/** The user's role on the server with this public id, or undefined for a non-member (and for a
 *  deleted or unknown server): the caller answers both with the same 404. */
export async function getMemberRole(
  db: Queryable,
  input: { publicId: string; userId: string },
): Promise<MemberRole | undefined> {
  const result = await db.query(SELECT_ROLE, [input.publicId, input.userId]);
  return parseFirst(RoleRowSchema, result.rows, "servers.getMemberRole")?.role;
}

export type AddMemberResult = "added" | "already_member" | "owner_exists" | "unknown_server_or_user";

const INSERT_MEMBER = `
  INSERT INTO servers.server_members (server_id, user_id, role)
  VALUES ($1, $2, $3)`;

/** Adds a member. The outcome comes from the database's own constraints, not a racy pre-check:
 *  a duplicate is `already_member`, a second owner is `owner_exists`. */
export async function addMember(
  db: Queryable,
  input: { serverId: string; userId: string; role: MemberRole },
): Promise<AddMemberResult> {
  try {
    await db.query(INSERT_MEMBER, [input.serverId, input.userId, input.role]);
    return "added";
  } catch (err) {
    if (isUniqueViolation(err)) {
      const constraint = uniqueViolationConstraint(err);
      if (constraint === ONE_OWNER_INDEX) {
        return "owner_exists";
      }
      if (constraint === MEMBER_PKEY) {
        return "already_member";
      }
    }
    if (isForeignKeyViolation(err)) {
      return "unknown_server_or_user";
    }
    throw err;
  }
}

const SET_ROLE = `
  UPDATE servers.server_members
  SET role = $3
  WHERE server_id = $1 AND user_id = $2 AND role <> 'owner'
  RETURNING 1 AS updated`;

/** Changes an admin or viewer's role. The owner's role is never changed here (and nobody becomes
 *  owner here): that is transferOwnership, which keeps exactly one owner throughout. */
export async function setMemberRole(
  db: Queryable,
  input: { serverId: string; userId: string; role: Exclude<MemberRole, "owner"> },
): Promise<boolean> {
  const result = await db.query(SET_ROLE, [input.serverId, input.userId, input.role]);
  return result.rows.length > 0;
}

const REMOVE_MEMBER = `
  DELETE FROM servers.server_members
  WHERE server_id = $1 AND user_id = $2 AND role <> 'owner'
  RETURNING 1 AS removed`;

/** Removes a non-owner member. The owner can't be removed (transfer ownership first). */
export async function removeMember(db: Queryable, input: { serverId: string; userId: string }): Promise<boolean> {
  const result = await db.query(REMOVE_MEMBER, [input.serverId, input.userId]);
  return result.rows.length > 0;
}

export type TransferOwnershipResult = "transferred" | "not_owner" | "target_not_member";

const DEMOTE_OWNER = `
  UPDATE servers.server_members
  SET role = 'admin'
  WHERE server_id = $1 AND user_id = $2 AND role = 'owner'
  RETURNING 1 AS demoted`;

const PROMOTE_TARGET = `
  UPDATE servers.server_members
  SET role = 'owner'
  WHERE server_id = $1 AND user_id = $2
  RETURNING 1 AS promoted`;

class RollBack extends Error {
  constructor(readonly outcome: TransferOwnershipResult) {
    super(outcome);
  }
}

/**
 * Swaps the owner in ONE transaction: the current owner becomes admin, the target becomes owner.
 * If the target is not a member (or the caller is not the owner) nothing changes. Takes a pool,
 * not a Queryable, because atomicity is the point.
 */
export async function transferOwnership(
  pool: Parameters<typeof withTransaction>[0],
  input: { serverId: string; fromUserId: string; toUserId: string },
): Promise<TransferOwnershipResult> {
  if (input.fromUserId === input.toUserId) {
    return "target_not_member"; // transferring to yourself is a no-op the caller should not request
  }
  try {
    await withTransaction(pool, async (client) => {
      const demoted = await client.query(DEMOTE_OWNER, [input.serverId, input.fromUserId]);
      if (demoted.rows.length === 0) {
        throw new RollBack("not_owner");
      }
      const promoted = await client.query(PROMOTE_TARGET, [input.serverId, input.toUserId]);
      if (promoted.rows.length === 0) {
        throw new RollBack("target_not_member");
      }
    });
    return "transferred";
  } catch (err) {
    if (err instanceof RollBack) {
      return err.outcome;
    }
    throw err;
  }
}
