# ADR-0047: Account deletion and leaving a server

Status: proposed. Needs the owner's approval (decisions and the questions at the end). Issue #311 tasks 2 and 3.

## Context
- #311 is a gate on the mod's first public release (ADR-0046 section 7; ADR-0025: "Account deletion ships with 1b at
  the latest"). Task 1 shipped as #511: a deferred constraint trigger refuses a commit that leaves a live server with
  no owner row (`backend/migrations/1791244800000_members_never_ownerless.sql:17-36`).
- Paths are under `backend/src/modules/` unless they start with a top-level directory.

**What the code does today:**

| Fact | Evidence |
|---|---|
| Every table that references `identity.users` cascades on delete: sign-in identities, sessions, memberships, push subscriptions (and their outbox rows), push opt-ins | `backend/migrations/1790294400000_core_tables.sql:21,55,80`; `backend/migrations/1791331200000_web_push.sql:20,37` |
| The audit trail has no foreign keys ("outlives the users and servers it mentions") and the runtime role cannot UPDATE or DELETE it; only the 1-year purge function deletes | `1790294400000_core_tables.sql:92-105`; `backend/migrations/1790380800000_audit_purge.sql` |
| Audit `detail` holds ids and codes only, never emails or names | `platform/audit/auditRepository.ts:10` |
| Two more columns name a user without a foreign key: who made an enrolment code and who sent a command | `backend/migrations/1790899200000_agents.sql:26`; `backend/migrations/1790985600000_agent_commands.sql:24` |
| A server's full delete (#516, "leaves nothing") is `softDeleteServer`: members, connection, then every table in `PURGED_TABLES`, in its own transaction | `servers/repositories/serverRepository.ts:170-195,206-227,238` |
| Its audit row is `server.deleted` with ids only, no reason field yet | `serverRepository.ts:218-220` |
| One owner per server at most (unique index); a membership change writes its audit row in the same statement; `transferOwnership` maps the trigger's refusal to `would_orphan` | `1790294400000_core_tables.sql` (`server_members_one_owner`); `servers/repositories/memberRepository.ts:56-66,156,213-214` |
| `would_orphan` exists only as a repository result, not as an API error code | `packages/shared/src/errors.ts:9-70` |
| No HTTP route adds, removes or transfers members today (no members API, ADR-0025 1b) | `grep transferOwnership\|removeMember backend/src` finds only the repository and metrics names |
| A session row is created at each sign-in (rotation ends the previous one), so `sessions.created_at` is the time of the last sign-in; lookups use the database's clock | `identity/dbSessionStore.ts:31-45`; `identity/repositories/sessionRepository.ts:66-80` |
| The operator's account is re-ensured and seeded as owner of every ownerless operator server at each start | `backend/src/server.ts:433-447`; `servers/loadDatabaseServers.ts:75-86` |
| The operator's disable revokes owned servers' agents but keeps data; `remove-server` is the CLI full delete | `identity/accountAdmin.ts:38-47`; `backend/scripts/admin.ts:38-41` |
| The privacy page already promises: "Deleting your account removes your user record, your sign-in identity, your sessions and your memberships. A server you own is handed over or deleted first." Audit events kept 1 year, backups 37 days, logs 14 days | `frontend/public/privacy.html:135,150-155,165-167` |
| Google documents `prompt` values `none`, `consent`, `select_account` only; `auth_time` needs a settings switch | Google OpenID Connect guide, checked 2026-10-20 |

## Decision

### 1. Delete the user row, do not anonymise it
`DELETE FROM identity.users WHERE id = $1`. The cascades remove sign-in identities, sessions, the remaining (non-owner)
memberships, push subscriptions with their queued pushes, and push opt-ins in the same statement. A later sign-in with
the same Google account is a new account (new uuid) when sign-up is open, and `not_invited` when it is closed.

Rejected: anonymising (keep the row, blank the email and name, add a `deleted` status). It keeps a row that is useless
once the identity is gone, adds a status every query must exclude, and contradicts what the privacy page already
promises. Its only gain, keeping foreign-key targets, does not apply: nothing that outlives the user has a key to it.

### 2. Audit rows stay, unchanged, for their normal year
Rows that name the user's uuid (as actor, or `detail.userId`) are kept and purged at 1 year like every other row. The
uuid is random; once the user row and identity are gone, nothing in the live database maps it back to a person. Backups
(37 days) and logs (14 days) still can, and the privacy page says so. The same holds for `created_by` on enrolment codes
and commands of servers that are not deleted.

Rejected: rewriting the trail at deletion. It would need a second SECURITY DEFINER door into an append-only table
(the runtime role has no UPDATE, on purpose), and the trail exists to answer "which account did this" after abuse,
including by an account that then deleted itself.

New audit rows, ids and counts only:
- `server.deleted`, actor the user, `detail: { reason: "account_deleted" }`, one per deleted server (the `reason` field
  is the one #526 adds for `never_enrolled`).
- `account.deleted`, actor the user, `detail: { userId, serversDeleted, membershipsLeft, pushSubscriptions }`.
- `member_left`, actor the user, `detail: { userId, role }` (the CTE pattern of `memberRepository.ts:135-145`).

### 3. What deleting an account does to servers
In one transaction, under the server-management advisory lock (`servers/importServers.ts:14`) so a create in another
tab cannot add a server mid-deletion:
- Owned, live, `created_via = 'self_serve'` servers are soft-deleted through the same in-transaction purge
  `softDeleteServer` runs (members, connection, `PURGED_TABLES`). That removes their agent credentials and codes, so an
  agent's next request is a 401. After the commit, each runtime entry is dropped, as the HTTP remove does
  (`servers/serverManagement.ts:495-497`).
- Owned operator-created servers block the deletion: 409 `would_orphan` with the list. No automatic handover. Today no
  non-operator owns one (only the operator creates them and there is no transfer route), so the list is empty in
  practice. It is the correct answer once one exists.
- The operator's own account is refused (403 `forbidden`, reason `operator_account`): it owns the operator servers, and
  the startup re-creates it anyway.
- Non-owner memberships go with the user row (the trigger does not fire for a non-owner).

### 4. Leaving a server
`POST /api/servers/:serverId/members/me/leave` (server-scoped, ADR-0001), for any member. It removes the caller's
non-owner membership and their push opt-in for that server in one transaction, with `member_left`. The owner is refused
409 `would_orphan` (reason `last_owner`). With at most one owner, every owner is the last one: they delete the server
(self-serve, #526) or, later, transfer it (members API). Today only owners exist, so this route matters from ADR-0025 1b
on. It ships now because it is a release gate and costs one statement.

### 5. Recent sign-in for deletion
`DELETE /api/account` requires the caller's session to be at most 10 minutes old (`sessions.created_at`, checked in the
deleting transaction against the database clock), else 403 `reauth_required`. The client sends the user through Google
sign-in again, back to Settings. Google offers no forced re-authentication (no `prompt=login`), so the guarantee is
"a fresh Google round trip", which is what a stolen session cookie cannot produce. Leaving a server needs no
re-authentication: it is reversible by an invite and touches nobody else's data.

### 6. Error codes (two new, additive per ADR-0007)
- `would_orphan` (409): the change would leave a server without an owner. `reason`: `last_owner` (leave),
  `operator_servers` (account deletion). For `operator_servers` the envelope carries the servers.
- `reauth_required` (403): sign in again first. 403, not 401, so the client does not treat it as "signed out".
- Reused: `forbidden` (`operator_account`), `rate_limited`, `server_not_found`, `unauthorized`, `service_unavailable`.

### 7. Where the code goes (no new module edge)
Account deletion is orchestrated in `identity/` (it owns the user row and the route), with servers' part behind a port
that `identity/` defines and `servers/` implements, wired in the composition root. `ALLOWED_MODULE_EDGES` stays
`identity: []` and `servers: []` (`backend/src/architecture.test.ts:28-47`), the structural-port precedent of
`AgentIngestDeps.mapLive`. The leave route lives in `servers/`.

## Consequences
- The release gate in ADR-0046 section 7 for #311 closes with tasks 2 and 3 and #530's privacy copy.
- A deleted account's activity stays attributable to a random id for a year; anyone holding a backup can link it for
  37 days.
- Delete-and-recreate with the same Google account is possible when sign-up is open; C5 and C8 bound it.
- `softDeleteServer` gains an in-transaction form; every server delete (HTTP remove, sweep, CLI, account deletion)
  still runs one list.

## Explicitly deferred
| Pattern | Not yet because | Trigger |
|---|---|---|
| A grace period (soft-deleted account, restore within N days) | Backups already give 37 days for a mistaken deletion, and a grace period keeps data longer | The first request to undo a deletion |
| A hashed tombstone of deleted Google subjects (to stop delete-and-recreate) | C5 and C8 bound churn; it would itself be personal data | `list-servers` shows one person recycling accounts |
| An operator `transfer-owner` CLI | No non-operator owns an operator server | The first `operator_servers` refusal |
| A data export ("download my data") | The privacy page offers it by email | Open sign-up's first export request, or a legal requirement the owner names |

## Revisit when
- The members API (ADR-0025 1b) lands: leaving and transfer become routine, and a transfer route may replace the
  `operator_servers` refusal.
- A second backend instance (the in-memory rate limits).

## Questions for the owner
1. Delete the user row (recommended), or anonymise it?
2. Keep audit rows naming the deleted account's random id for their normal year (recommended), or scrub them?
3. Require a sign-in within the last 10 minutes to delete an account (recommended), or only a typed confirmation?
4. Add an operator CLI `delete-user <user-id>` running the same deletion, for email requests and disabled accounts
   (recommended, in task 2)?
5. Immediate deletion with no grace period (recommended)?
