# Runbook: abuse response (#516, ADR-0045)

When a server or an account abuses the service, you cut it off and remove its data in minutes. Everything here
runs on the PC against the app database (`DATABASE_URL` in `backend/.env`); shell access to the PC is the trust boundary
([ADR-0025](../decisions/0025-postgres-and-google-sign-in.md) decision 4). Nothing here prints a secret, and every audit row
holds ids and counts only, never an email or a name.

## 1. Find the server

- **List.** `npm run admin -- list-servers` prints every live server: id, name, kind, owner user id, whether an agent
  is enrolled, when it was last seen, and the history row counts. Ids and numbers only. (`created_via`, ADR-0046 #525,
  is added to this list when that column exists.)
- **Refusals and load.** The agent refusal counter `satis.agent.refused` (#514; labels `server` and `status`) shows
  which server's agent is being refused or is sending too much ([`agents.md`](./agents.md)). It names the server id, not a
  person.
- **Storage.** Which servers hold the most history (run with `psql "$DATABASE_URL"`):

  ```sql
  SELECT s.public_id, count(*) AS power_rows
  FROM telemetry.power_samples p JOIN servers.servers s ON s.id = p.server_id
  GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
  -- the same with telemetry.item_samples; add the rollup tables to see what the retention keeps
  ```

- **Who owns it.** The owner's user id (an id, not an email):

  ```sql
  SELECT m.user_id FROM servers.server_members m JOIN servers.servers s ON s.id = m.server_id
  WHERE s.public_id = '<server-id>' AND m.role = 'owner';
  ```

  Read this BEFORE removing the server: the removal deletes the memberships and clears the name (ADR-0047 amendment), so
  note the name too if you need it for your own records (outside the repository).

## 2. Cut the server off and remove its data

On the PC, with `DATABASE_URL` set:

```
npm run admin -- remove-server <public-id>
```

This works for any server, including a self-serve one the operator is not a member of. (The HTTP route
`DELETE /api/servers/<server-id>` is the same delete, but it answers 404 to a non-member. A self-serve server's owner may
use it on their own server, and the C4 sweep uses the same delete for self-serve servers that never enrolled within
`SELF_SERVE_PENDING_TTL_HOURS`, #526; see [`agents.md`](./agents.md).) **Restart the backend
afterwards**: the CLI cannot stop the pollers of a running backend, and a local server's pollers would keep recording
until it restarts. The command writes `server.deleted` (no actor, the server's internal id).

In one transaction it marks the server removed, writes the `server.deleted` audit event, stops its pollers, and deletes
everything stored for it. That revokes an enrolled agent (its credential and any unspent code go, so the agent gets 401
and can never reach a re-created id). **After a removal nothing is left for that id.** The list, by table:

| Table | How it is cleared |
|---|---|
| `servers.servers` | kept, soft deleted; its `display_name` is set to NULL (ADR-0047 amendment) |
| `servers.server_members` | deleted (memberships, including the owner) |
| `servers.server_connections` | deleted (the encrypted game-server tokens) |
| `telemetry.power_samples`, `item_samples`, `power_rollups`, `item_rollups`, `building_transitions` | deleted |
| `alerts.rules` | deleted; `alerts.alert_state` goes with it (cascade) |
| `alerts.alert_events` | deleted; its `alerts.outbox` rows go with it (cascade) |
| `alerts.server_mutes` | deleted |
| `alerts.destinations` (the encrypted webhook) | deleted; its outbox rows cascade |
| `alerts.push_optins` | deleted (#516) |
| `map.world_layers` | deleted (#516) |
| `agents.enrollment_codes`, `agent_credentials`, `commands` | deleted |

What stays on purpose: the `servers.servers` row itself (soft deleted, so the audit trail keeps pointing at it) with its
ids only (the internal uuid and the public id; the name is cleared, so nothing a person typed is left), and the audit
events about it (ids and codes, never the name). A removed server is therefore not in `list-servers`, and you look it up
by its public id. Names are not unique anywhere, so clearing one frees or blocks nothing; the public id stays taken (a
self-serve id is never handed out again). Every removal path clears the name the same way: `remove-server`, the HTTP
remove (the operator's, or a self-serve owner's), the C4 sweep, and account deletion (step 4). A server created again
with the same id revives that row, with the name it is created or imported with, and **starts empty**: the revive runs
the same per-server clean-up again (everything above except the memberships and the connection), whatever raced the
removal. Servers removed before the migration `removed_servers_keep_no_name` lost their names in that migration. A test compares the tables that reference `servers.servers` in the database with the delete list in the code
(`PURGED_TABLES`, plus the members and connections), so a new table fails the build until it is added. Servers removed before #516 left
world layers and push opt-ins behind; the migration `purge_removed_server_leftovers` deletes those once.

## 3. Disable the owner

```
npm run admin -- disable-user <user-id>
```

It sets the account's status to `disabled`, revokes all its sessions, and revokes the agent credentials (and drops the
unspent enrolment codes) of the live servers the account OWNS, all in one transaction. The person is signed out at once
and Google sign-in refuses the account from then on (reason `disabled`, written to the audit log). The servers and their
data stay; after re-enabling, the owner enrols an agent again. It writes `user.disabled` with the user id and the
numbers of sessions and agent credentials revoked. To undo it:

```
npm run admin -- enable-user <user-id>
```

That writes `user.enabled` (with the number of stray sessions it revoked). The sessions that were revoked stay revoked
and so do the agent credentials; the person signs in again and enrols a new agent. To only sign someone
out, without disabling them: `npm run admin -- revoke-sessions --user <user-id>`
([`database.md`](./database.md)).

Disabling covers the servers the account OWNS. A server it only belongs to as an admin or viewer is not touched; remove it
(step 2) or revoke only its agent with `DELETE /api/servers/<server-id>/agent` ([`agents.md`](./agents.md)).

## 4. Delete an account (ADR-0047)

For a deletion request that arrives by email, or a disabled account that should go for good:

```
npm run admin -- delete-user <user-id>
```

It is the same deletion as a signed-in user's own `DELETE /api/account` (Settings), without the recent-sign-in check
(shell access is the trust boundary here). In one transaction, under the server-management lock:

- The servers the account OWNS now (its owner membership, not who created them) that were created through self-serve are
  removed with the step 2 purge, name included, each audited `server.deleted` with the user as actor and
  `detail: { reason: "account_deleted" }`. Their agents get 401 from then on.
- An owned operator-created server refuses the deletion and nothing changes: the command names the servers. Remove them
  first (step 2); there is no transfer command yet.
- The operator's own account is refused (the backend re-creates it at startup anyway).
- The user row is deleted, and with it (database cascades) the sign-in identities, sessions, the other memberships, push
  subscriptions with their queued pushes, and push opt-ins. It writes `account.deleted` with the user id and the counts.

What stays: audit rows naming the account's id, for their normal year (the id is random and nothing left maps it to a
person; backups do, for 37 days), and `created_by` on enrolment codes and commands of servers that are not removed.
There is no grace period and no undo; a later Google sign-in is a new account (or `not_invited` while sign-up is closed).
Restart the backend afterwards if servers were removed (the CLI cannot drop a running backend's entries; the HTTP route
does it at once).

A signed-in user can also leave a server they do not own: `POST /api/servers/<server-id>/members/me/leave` removes their
membership and their push opt-in for it (audited `member_left`). The owner is refused (409 `would_orphan`) and removes
the server from Satisfactory Dash instead.

## 5. After restoring a backup, re-apply this

A backup is a snapshot: restoring one brings back what was revoked or removed AFTER it was taken. Right after a restore
([`backups.md`](./backups.md), "Restore rehearsal"), before the backend takes traffic:

1. **Disabled accounts** are active again. Run `disable-user <user-id>` for each account disabled since the dump (the
   audit log of the lost period is gone too, so keep your own list of the ids you disabled, OUTSIDE the repository: a
   gitignored file or private notes next to `.env`. User ids are pseudonymous personal data and this repository is
   public, so this page describes the procedure and never holds the list).
2. **Removed servers** are back with their data, names, members and agent credentials. Remove each again (step 2).
   **Deleted accounts** are back too: run `delete-user <user-id>` again for each (the same rule as for disabled ones: keep
   the ids outside the repository).
3. **Revoked agent credentials** work again. Revoke each (`DELETE /api/servers/<server-id>/agent`), or remove the server.
4. **Revoked sessions** are live again. If anything was compromised, `npm run admin -- revoke-sessions --all`.
5. **Keys.** If a secret was exposed, rotate it ([`servers.md`](./servers.md), key rotation).

## Not covered here

The Settings page for deleting your own account and leaving a server is #311's frontend task. A page in the app for the
operator's commands is out of scope for #516.
