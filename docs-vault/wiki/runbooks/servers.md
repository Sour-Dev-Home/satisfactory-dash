# Runbook: servers and the secrets key (ADR-0030, as amended by ADR-0066)

> **Mostly retired by [ADR-0066](../decisions/0066-mod-only-retire-node-agent-and-direct-poll.md).** The backend no longer
> stores game-server connections or calls a game server: direct-poll (`local`) servers, `import-servers`, the add / edit /
> test-connection routes, the LAN and address rules and "switch back to local" are gone (build PRs 5 and 6). Every server
> connects through the SatisDashAgent mod and `/agent/v1`; enrolling, pairing, revoking and commands are in
> [`agents.md`](./agents.md). The earlier version of this page, with the import steps and the connection rules, is in its
> git history. What is still current is below.

## Servers today

- A server is created by the operator or, with self-serve on, by any signed-in user (ADR-0046), then enrolled with a code
  the mod redeems (`agents.md`). A mod host installs SML (`^3.12.0`) and SatisDashAgent 0.2.0 only, with no FRM
  (ADR-0058, R7); an old `frmPort`/`frmToken` in the mod's settings is ignored with one log line.
- The operator's managed list is `GET /api/servers/managed` (`{ agentServers }`); `PATCH /api/servers/:serverId/name`
  renames and `DELETE /api/servers/:serverId` removes (for the table-by-table clean-up see `abuse-response.md`). Both
  writes share one limit: 30 per 15 minutes per user (`WRITE_LIMIT`). The audit events are `server.updated` (the field
  name only, never the new name) and `server.deleted` (ids only).
- Former `local` rows were converted to `agent` by PR 5's data step, with their history and members kept; they show as
  servers awaiting the mod until it enrols.

## The key: `SERVER_SECRETS_KEY`

It seals the alert webhooks (`alerts.destinations`) and the web-push data (`alerts.push_subscriptions`). The old sealed
game tokens are gone: nothing read `servers.server_connections` after ADR-0066 PR 10a, and PR 10b dropped that table.

- 32 random bytes as base64. PowerShell 7: `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`
  (or `openssl rand -base64 32`).
- It lives in `backend\.env`. Unset is fine if no webhook or push is used; set but malformed stops the backend.
- **Back it up offline the same day, like the age key** (your password manager). A database backup holds only
  ciphertext, so a restore is unreadable without this key.
- Never commit it, paste it into chat, or put it in a log. Errors and logs from the backend never contain it, a secret,
  or a ciphertext.

Optional, for a rotation (below): `SERVER_SECRETS_KEY_ID` (a short label for the current key, default `k1`)
and `SERVER_SECRETS_PREVIOUS_KEYS` (`id=base64,id2=base64`, retired keys kept only to read old rows).

## Rotating the key

1. Generate a new key and give it a NEW id: `SERVER_SECRETS_KEY_ID=k2`, `SERVER_SECRETS_KEY=<new>`, and move the old
   one to `SERVER_SECRETS_PREVIOUS_KEYS=k1=<old>`. Back the new key up offline.
2. Restart. Old rows still open with the old key; new values are sealed with the current one.
3. Only remove an old key from `SERVER_SECRETS_PREVIOUS_KEYS` once no row uses its id, in every table that carries a
   `key_id` (as the admin role): `alerts.destinations` and `alerts.push_subscriptions`, e.g.
   `SELECT key_id, count(*) FROM alerts.destinations GROUP BY 1;`, or run `npm run admin -- verify-secrets` with only
   the new key (below).

## Backup and restore

The nightly backup covers these tables, encrypted twice over (values sealed by the key, the dump sealed by age). The
restore rehearsal runs `npm run admin -- verify-secrets` against the scratch database (see `backups.md`): since ADR-0066
PR 10a it opens every alert webhook (`alerts.destinations`) and web-push subscription (`alerts.push_subscriptions`) with
the backed-up key and prints how many of each opened and which rows could not (row and key id, never a value), exiting
1 if any cannot be opened or there are none at all. `servers.server_connections`, which it used to read, was dropped in ADR-0066 PR 10b.
