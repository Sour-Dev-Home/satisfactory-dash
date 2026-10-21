import { z } from "zod";
import {
  isForeignKeyViolation,
  isOwnerlessServerViolation,
  isUniqueViolation,
  uniqueViolationConstraint,
} from "../../../platform/db/errors.js";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import type { MemberRole } from "./serverRepository.js";

/**
 * Server memberships (ADR-0020, ADR-0025 decision "authorization"). The rules live in the
 * database: primary key (server, user), a role check, and a partial unique index that allows at
 * most one owner per server. Every lookup scopes by user AND resolves the server by its public
 * id in the same query, so a caller cannot ask about a server without stating who is asking.
 *
 * NEVER OWNERLESS (#311): the one-owner index allows AT MOST one owner; a deferred constraint
 * trigger (`server_members_never_ownerless`, migration 1791244800000) supplies the other half. At
 * commit, a live server with no owner row makes the transaction fail with `ownerless_server`, so
 * deleting an owner's account (which cascades memberships away) is refused until the server is
 * transferred or deleted. The deferral lets one transaction pass through an ownerless moment, as
 * transferOwnership and softDeleteServer do.
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
  const result = await timedQuery(db, "servers.getMemberRole", SELECT_ROLE, [input.publicId, input.userId]);
  return parseFirst(RoleRowSchema, result.rows, "servers.getMemberRole")?.role;
}

export type AddMemberResult = "added" | "already_member" | "owner_exists" | "unknown_server_or_user";

/*
 * Every membership change writes its audit row IN THE SAME STATEMENT (a data-modifying CTE), so
 * the row exists exactly when the change happened: no window between the two, and a refused
 * change (a constraint violation, nothing matched) leaves no row. `detail` holds ids and roles
 * only (the audit rule); `$n` for the actor is NULL for the system (startup registration).
 */
const INSERT_MEMBER = `
  WITH added AS (
    INSERT INTO servers.server_members (server_id, user_id, role)
    VALUES ($1, $2, $3)
    RETURNING server_id, user_id, role
  )
  INSERT INTO audit.audit_events (actor_user_id, server_id, action, detail)
  SELECT $4::uuid, server_id, 'member_added',
         jsonb_build_object('userId', user_id, 'role', role)
           || CASE WHEN $5::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('source', $5::text) END
  FROM added`;

/** Adds a member. The outcome comes from the database's own constraints, not a racy pre-check:
 *  a duplicate is `already_member`, a second owner is `owner_exists`. `actorUserId` is who did it
 *  (omit it for the system, e.g. startup registration of the bootstrap owner). */
export async function addMember(
  db: Queryable,
  input: { serverId: string; userId: string; role: MemberRole; actorUserId: string | null; source?: "startup_seed" },
): Promise<AddMemberResult> {
  try {
    await timedQuery(db, "servers.addMember", INSERT_MEMBER, [input.serverId, input.userId, input.role, input.actorUserId, input.source ?? null]);
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

// `role <> $3` keeps a no-op update out of the UPDATE, so RETURNING is empty and no audit row is
// written; `current` (the same non-owner member, before the update) tells "unchanged" apart from
// "not found".
const SET_ROLE = `
  WITH current AS (
    SELECT 1 AS present
    FROM servers.server_members
    WHERE server_id = $1 AND user_id = $2 AND role <> 'owner'
  ), changed AS (
    UPDATE servers.server_members
    SET role = $3
    WHERE server_id = $1 AND user_id = $2 AND role <> 'owner' AND role <> $3
    RETURNING server_id, user_id, role
  ), audited AS (
    INSERT INTO audit.audit_events (actor_user_id, server_id, action, detail)
    SELECT $4::uuid, server_id, 'member_role_changed', jsonb_build_object('userId', user_id, 'role', role)
    FROM changed
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM changed) THEN 'changed'
    WHEN EXISTS (SELECT 1 FROM current) THEN 'unchanged'
    ELSE 'not_found'
  END AS outcome`;

const SetRoleRowSchema = z.object({ outcome: z.enum(["changed", "unchanged", "not_found"]) });

/** `changed`: the role was updated (and audited). `unchanged`: the member already had that role,
 *  nothing was written. `not_found`: no such non-owner member of that server. */
export type SetMemberRoleResult = "changed" | "unchanged" | "not_found";

/** Changes an admin or viewer's role. The owner's role is never changed here (and nobody becomes
 *  owner here): that is transferOwnership, which keeps exactly one owner throughout. */
export async function setMemberRole(
  db: Queryable,
  input: { serverId: string; userId: string; role: Exclude<MemberRole, "owner">; actorUserId: string | null },
): Promise<SetMemberRoleResult> {
  const result = await timedQuery(db, "servers.setMemberRole", SET_ROLE, [input.serverId, input.userId, input.role, input.actorUserId]);
  return parseFirst(SetRoleRowSchema, result.rows, "servers.setMemberRole")?.outcome ?? "not_found";
}

const REMOVE_MEMBER = `
  WITH removed AS (
    DELETE FROM servers.server_members
    WHERE server_id = $1 AND user_id = $2 AND role <> 'owner'
    RETURNING server_id, user_id, role
  ), audited AS (
    INSERT INTO audit.audit_events (actor_user_id, server_id, action, detail)
    SELECT $3::uuid, server_id, 'member_removed', jsonb_build_object('userId', user_id, 'role', role)
    FROM removed
  )
  SELECT 1 AS removed FROM removed`;

/** Removes a non-owner member. The owner can't be removed (transfer ownership first). */
export async function removeMember(
  db: Queryable,
  input: { serverId: string; userId: string; actorUserId: string | null },
): Promise<boolean> {
  const result = await timedQuery(db, "servers.removeMember", REMOVE_MEMBER, [input.serverId, input.userId, input.actorUserId]);
  return result.rows.length > 0;
}

// ADR-0047 decision 4: a member leaves a live server. ONE statement: the caller's non-owner membership, their push opt-in
// for that server, and `member_left` (actor the user, ids and the role only). Every sub-statement sees the snapshot from
// before the statement, so the final SELECT tells "the owner" (nothing removed, an owner row) from "not a member".
const LEAVE_SERVER = `
  WITH target AS (
    SELECT id FROM servers.servers WHERE public_id = $1 AND deleted_at IS NULL
  ), removed AS (
    DELETE FROM servers.server_members m
    USING target t
    WHERE m.server_id = t.id AND m.user_id = $2 AND m.role <> 'owner'
    RETURNING m.server_id, m.user_id, m.role
  ), opted_out AS (
    DELETE FROM alerts.push_optins o
    USING removed r
    WHERE o.server_id = r.server_id AND o.user_id = r.user_id
  ), audited AS (
    INSERT INTO audit.audit_events (actor_user_id, server_id, action, detail)
    SELECT user_id, server_id, 'member_left', jsonb_build_object('userId', user_id, 'role', role)
    FROM removed
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM removed) THEN 'left'
    WHEN EXISTS (
      SELECT 1 FROM servers.server_members m JOIN target t ON t.id = m.server_id WHERE m.user_id = $2 AND m.role = 'owner'
    ) THEN 'last_owner'
    ELSE 'not_member'
  END AS outcome`;

/** `left`: the membership and the push opt-in are gone (audited). `last_owner`: the caller owns the server, nothing changed
 *  (at most one owner, so every owner is the last one). `not_member`: not a member of a live server with that id. */
export type LeaveServerResult = "left" | "last_owner" | "not_member";

export async function leaveServer(db: Queryable, input: { publicId: string; userId: string }): Promise<LeaveServerResult> {
  const result = await timedQuery(db, "servers.leaveServer", LEAVE_SERVER, [input.publicId, input.userId]);
  return parseFirst(z.object({ outcome: z.enum(["left", "last_owner", "not_member"]) }), result.rows, "servers.leaveServer")?.outcome ?? "not_member";
}

export type TransferOwnershipResult = "transferred" | "not_owner" | "target_not_member" | "same_user" | "would_orphan";

// ADR-0047 (security review, Low): the server row first, the order enrolment, revoke, the owner's remove and account
// deletion take, so a transfer away from an account being deleted waits for that deletion. Then the TARGET account's row
// (KEY SHARE): account deletion holds it FOR UPDATE before it reads what the account owns, so a transfer to an account
// being deleted waits and then finds no target, and a deletion that starts after the transfer sees the new ownership.
const LOCK_TRANSFER_SERVER = `
  SELECT id FROM servers.servers WHERE id = $1 AND deleted_at IS NULL FOR NO KEY UPDATE`;

const LOCK_TRANSFER_TARGET = `
  SELECT id FROM identity.users WHERE id = $1 FOR KEY SHARE`;

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

const AUDIT_TRANSFER = `
  INSERT INTO audit.audit_events (actor_user_id, server_id, action, detail)
  VALUES ($1::uuid, $2::uuid, 'ownership_transferred', jsonb_build_object('toUserId', $3::text))`;

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
    return "same_user"; // a no-op the caller should not request; nothing is touched
  }
  try {
    await withTransaction(pool, async (client) => {
      if ((await timedQuery(client, "servers.transferOwnership.lockServer", LOCK_TRANSFER_SERVER, [input.serverId])).rows.length === 0) {
        throw new RollBack("not_owner");
      }
      // An unknown target locks nothing; the promotion below then finds no member (target_not_member), as before.
      await timedQuery(client, "servers.transferOwnership.lockTarget", LOCK_TRANSFER_TARGET, [input.toUserId]);
      const demoted = await timedQuery(client, "servers.transferOwnership.demoteOwner", DEMOTE_OWNER, [input.serverId, input.fromUserId]);
      if (demoted.rows.length === 0) {
        throw new RollBack("not_owner");
      }
      const promoted = await timedQuery(client, "servers.transferOwnership.promoteTarget", PROMOTE_TARGET, [input.serverId, input.toUserId]);
      if (promoted.rows.length === 0) {
        throw new RollBack("target_not_member");
      }
      // In the same transaction as the swap: the audit row and the ownership change stand or
      // fall together. The server id here is the internal uuid, as in every audit row.
      await timedQuery(client, "servers.transferOwnership.audit", AUDIT_TRANSFER, [input.fromUserId, input.serverId, input.toUserId]);
    });
    return "transferred";
  } catch (err) {
    if (err instanceof RollBack) {
      return err.outcome;
    }
    // The commit-time check refused the swap (cannot happen while both updates succeed; this maps
    // the database's own refusal to a typed result should a future change break the swap).
    if (isOwnerlessServerViolation(err)) {
      return "would_orphan";
    }
    throw err;
  }
}
