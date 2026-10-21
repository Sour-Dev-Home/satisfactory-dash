# Runbook: abuse response (#516, ADR-0045)

When a server or an account abuses the service, you cut it off and remove its data in minutes. Everything here
runs on the PC against the app database (`DATABASE_URL` in `backend/.env`); shell access to the PC is the trust boundary
([ADR-0025](../decisions/0025-postgres-and-google-sign-in.md) decision 4). Nothing here prints a secret, and every audit row
holds ids and counts only, never an email or a name.

## 1. Find the server

- **Refusals and load.** The agent refusal counters (#514) and the metrics page show which server's agent is being
  refused or is sending too much. They name the server id, not a person.
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

  Read this BEFORE removing the server: the removal deletes the memberships.

## 2. Cut the server off and remove its data

Sign in as the operator and call the remove route (the same one the server settings page uses):

```
DELETE /api/servers/<server-id>
```

In one transaction it marks the server removed, writes the `server.deleted` audit event, stops its pollers, and deletes
everything stored for it. That revokes an enrolled agent (its credential and any unspent code go, so the agent gets 401
and can never reach a re-created id). **After a removal nothing is left for that id.** The list, by table:

| Table | How it is cleared |
|---|---|
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

What stays on purpose: the `servers.servers` row itself (soft deleted, so the audit trail keeps pointing at it) and the
audit events about it. A server created again with the same id revives that row and **starts empty**; a test lists every
table that references `servers.servers` and fails when a new one is not on this list. Servers removed before #516 left
world layers and push opt-ins behind; the migration `purge_removed_server_leftovers` deletes those once.

## 3. Disable the owner

```
npm run admin -- disable-user <user-id>
```

It sets the account's status to `disabled` and revokes all its sessions in the same transaction, so the person is signed
out at once and Google sign-in refuses the account from then on (reason `disabled`, written to the audit log). It writes
`user.disabled` with the user id and the number of sessions revoked. To undo it:

```
npm run admin -- enable-user <user-id>
```

That writes `user.enabled`. The sessions that were revoked stay revoked; the person signs in again. To only sign someone
out, without disabling them: `npm run admin -- revoke-sessions --user <user-id>`
([`database.md`](./database.md)).

An agent credential belongs to a server, not to the account: disabling the owner does not stop an agent that is still
enrolled. Remove the server (step 2), or revoke only its agent with `DELETE /api/servers/<server-id>/agent`
([`agents.md`](./agents.md)).

## 4. After restoring a backup, re-apply this

A backup is a snapshot: restoring one brings back what was revoked or removed AFTER it was taken. Right after a restore
([`backups.md`](./backups.md), "Restore rehearsal"), before the backend takes traffic:

1. **Disabled accounts** are active again. Run `disable-user <user-id>` for each account disabled since the dump (the
   audit log of the lost period is gone too, so keep your own list of ids; this page is the place to keep it).
2. **Removed servers** are back with their data, members and agent credentials. Remove each again (step 2).
3. **Revoked agent credentials** work again. Revoke each (`DELETE /api/servers/<server-id>/agent`), or remove the server.
4. **Revoked sessions** are live again. If anything was compromised, `npm run admin -- revoke-sessions --all`.
5. **Keys.** If a secret was exposed, rotate it ([`servers.md`](./servers.md), key rotation).

## Not covered here

Deleting your own account or leaving a server is #311. A page in the app for any of this is out of scope for #516.
