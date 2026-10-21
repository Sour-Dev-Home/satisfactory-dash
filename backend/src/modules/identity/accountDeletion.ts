import { z } from "zod";
import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import { isOwnerlessServerViolation } from "../../platform/db/errors.js";
import { parseFirst, parseOne } from "../../platform/db/rows.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { OPERATOR_SUBJECT } from "./authenticator.js";
import type { Db } from "./dbSessionStore.js";

/**
 * ADR-0047: deleting an account, for the user themselves (DELETE /api/account) and for the operator's CLI
 * (`npm run admin -- delete-user <user-id>`). Both run this one function.
 *
 * In ONE transaction:
 * 1. The operator's own account is refused (it owns the operator servers, and the startup re-creates it anyway).
 * 2. For the user's own request: the session it came with must have started within the last 10 minutes
 *    (`sessions.created_at` is the time of the last sign-in, checked against the database clock), else `reauth_required`.
 *    The CLI has no session (shell access is its trust boundary) and skips this.
 * 3. The servers' part, behind `AccountServersPort` (servers/accountServers.ts implements it; wired in the composition
 *    root): owned self-serve servers are removed with the usual purge; an owned operator-created server blocks the
 *    deletion (`operator_servers`, with the list) and nothing changes.
 * 4. `DELETE FROM identity.users`: the cascades remove the sign-in identities, sessions, the remaining (non-owner)
 *    memberships, push subscriptions with their queued pushes, and push opt-ins. Not anonymised (decision 1).
 * 5. `account.deleted`, actor the user, ids and counts only. The audit rows that name the user's random id are KEPT for
 *    their normal year (decision 2); `created_by` on enrolment codes and commands of servers that stay is kept too.
 * After the commit, the removed servers' runtime entries are dropped. No grace period: deletion is immediate.
 */
export interface AccountServersPort {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** Takes the server-management lock; called before the account row is locked (the self-serve create's order). */
  lockForDeletion(client: Queryable): Promise<void>;
  removeOwnedServers(
    client: Queryable,
    userId: string,
  ): Promise<{ outcome: "removed"; removed: string[] } | { outcome: "operator_servers"; servers: { id: string; displayName: string }[] }>;
  afterCommit(removedPublicIds: readonly string[]): Promise<void>;
}

export interface AccountDeletionDeps {
  db: Db;
  servers: AccountServersPort;
}

/** A sign-in at most this long ago may delete the account (ADR-0047 decision 5). */
export const REAUTH_WINDOW_MINUTES = 10;

export type DeleteAccountResult =
  | { outcome: "deleted"; serversDeleted: number; membershipsLeft: number; pushSubscriptions: number }
  /** No such account (the CLI's unknown id, or a second deletion that lost the race). */
  | { outcome: "not_found" }
  | { outcome: "operator_account" }
  /** The request's session is too old (or gone): sign in again first. */
  | { outcome: "reauth_required" }
  /** The database refused the commit twice because it would leave a server ownerless (ownership moved to this account while
   *  it was being deleted, and again on the retry). Nothing changed. */
  | { outcome: "last_owner" }
  | { outcome: "operator_servers"; servers: { id: string; displayName: string }[] };

export interface DeleteAccountInput {
  userId: string;
  /** The user's own request: the sha256 of the session it came with, which must be fresh. Omitted by the operator's CLI. */
  sessionIdHash?: Buffer;
}

export interface AccountDeletion {
  deleteAccount(input: DeleteAccountInput): Promise<DeleteAccountResult>;
}

const SELECT_ACCOUNT = `
  SELECT EXISTS (
    SELECT 1 FROM identity.auth_identities i WHERE i.user_id = u.id AND i.provider = 'local' AND i.provider_subject = $2
  ) AS is_operator
  FROM identity.users u
  WHERE u.id = $1`;

// The database's clock, as every session lookup uses. A revoked or expired session is not fresh either.
const SESSION_IS_FRESH = `
  SELECT (created_at > now() - make_interval(mins => $3::int)) AS fresh
  FROM identity.sessions
  WHERE id_hash = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`;

const COUNT_LEFTOVERS = `
  SELECT (SELECT count(*) FROM servers.server_members WHERE user_id = $1) AS memberships,
         (SELECT count(*) FROM alerts.push_subscriptions WHERE user_id = $1) AS push_subscriptions`;

const DELETE_USER = `DELETE FROM identity.users WHERE id = $1 RETURNING id`;

// Held until the commit, AFTER the server-management lock and BEFORE reading what the account owns: a transfer of ownership
// to this account (which takes the row FOR KEY SHARE) either committed before, so it is seen, or waits and then finds no
// target. Not the first statement, so the self-serve create (management lock, then the account row through its foreign
// key) never waits on it in the opposite order.
const LOCK_USER = `SELECT id FROM identity.users WHERE id = $1 FOR UPDATE`;

/** How many times the whole transaction runs when the commit is refused as ownerless (the first try plus one retry). */
const ATTEMPTS = 2;

class RollBack extends Error {
  constructor(readonly result: DeleteAccountResult) {
    super(result.outcome);
  }
}

export function createAccountDeletion(deps: AccountDeletionDeps): AccountDeletion {
  async function inTransaction(client: Queryable, input: DeleteAccountInput): Promise<{ result: DeleteAccountResult; removed: string[] }> {
    const account = parseFirst(z.object({ is_operator: z.boolean() }), (await timedQuery(client, "identity.deleteAccount.select", SELECT_ACCOUNT, [input.userId, OPERATOR_SUBJECT])).rows, "identity.deleteAccount.select");
    if (account === undefined) throw new RollBack({ outcome: "not_found" });
    if (account.is_operator) throw new RollBack({ outcome: "operator_account" });
    if (input.sessionIdHash !== undefined) {
      const session = parseFirst(
        z.object({ fresh: z.boolean() }),
        (await timedQuery(client, "identity.deleteAccount.sessionFresh", SESSION_IS_FRESH, [input.sessionIdHash, input.userId, REAUTH_WINDOW_MINUTES])).rows,
        "identity.deleteAccount.sessionFresh",
      );
      if (session?.fresh !== true) throw new RollBack({ outcome: "reauth_required" });
    }
    await deps.servers.lockForDeletion(client);
    if ((await timedQuery(client, "identity.deleteAccount.lockUser", LOCK_USER, [input.userId])).rows.length === 0) {
      throw new RollBack({ outcome: "not_found" });
    }
    const servers = await deps.servers.removeOwnedServers(client, input.userId);
    if (servers.outcome === "operator_servers") throw new RollBack(servers);
    const counts = parseOne(
      z.object({ memberships: z.coerce.number(), push_subscriptions: z.coerce.number() }),
      (await timedQuery(client, "identity.deleteAccount.count", COUNT_LEFTOVERS, [input.userId])).rows,
      "identity.deleteAccount.count",
    );
    const deleted = await timedQuery(client, "identity.deleteAccount.delete", DELETE_USER, [input.userId]);
    if (deleted.rows.length === 0) throw new RollBack({ outcome: "not_found" });
    const result = {
      outcome: "deleted" as const,
      serversDeleted: servers.removed.length,
      membershipsLeft: counts.memberships,
      pushSubscriptions: counts.push_subscriptions,
    };
    await recordAuditEvent(client, {
      action: "account.deleted",
      actorUserId: input.userId,
      detail: { userId: input.userId, serversDeleted: result.serversDeleted, membershipsLeft: result.membershipsLeft, pushSubscriptions: result.pushSubscriptions },
    });
    return { result, removed: servers.removed };
  }

  return {
    deleteAccount: (input) =>
      deps.servers.exclusive(async () => {
        for (let attempt = 1; ; attempt += 1) {
          let committed: { result: DeleteAccountResult; removed: string[] };
          try {
            committed = await withTransaction(deps.db, (client) => inTransaction(client, input));
          } catch (err) {
            if (err instanceof RollBack) return err.result;
            // The deferred never-ownerless trigger refused the commit (nothing was written): the account came to own a
            // server after it was read. Run it all again once, which sees the new ownership; then a typed refusal.
            if (isOwnerlessServerViolation(err)) {
              if (attempt < ATTEMPTS) continue;
              return { outcome: "last_owner" };
            }
            throw err;
          }
          await deps.servers.afterCommit(committed.removed);
          return committed.result;
        }
      }),
  };
}
