# Runbook: servers stored in the database (ADR-0030, phase 1)

Until now the game servers this backend talks to came from config: the single-server `SATISFACTORY_*`
variables or a servers file (`SATISFACTORY_SERVERS_FILE`). From this PR on they can live in the database
instead, with their two tokens (the game's API token and the FRM token) **encrypted at rest**
(AES-256-GCM). The database then wins over the config, and the config is retired.

Nothing changes until you import: with no servers in the database the backend keeps using the config
exactly as before.

## The key: `SERVER_SECRETS_KEY`

- 32 random bytes as base64. PowerShell 7: `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`
  (or `openssl rand -base64 32`).
- It lives in `backend\.env`. The backend refuses to start if it is set but malformed.
- **Back it up offline the same day, like the age key** (your password manager). A database backup
  holds only ciphertext, so a restore is unreadable without this key: **lose the key and the stored tokens
  are gone** (you would re-enter them from the game's own token and FRM config).
- Never commit it, paste it into chat, or put it in a log. Errors and logs from the backend never
  contain it, a token, or a ciphertext.

Optional, for a rotation (below): `SERVER_SECRETS_KEY_ID` (a short label for the current key, default `k1`)
and `SERVER_SECRETS_PREVIOUS_KEYS` (`id=base64,id2=base64`, retired keys kept only to read old rows).

## Deploy order (importing the servers)

The build from this PR needs a new migration (`1790467200000_server_connections`), and **the backend will
not start until `db:migrate` has run**.

1. Generate `SERVER_SECRETS_KEY`, put it in `backend\.env`, and **back it up offline** (above).
2. Stop the backend, pull, `npm ci`, `npm run build -w backend`, then **`npm run db:migrate -w backend`**.
3. Start the backend as usual. It still uses the config (nothing is in the database yet).
4. Import: `npm run admin -- import-servers` (from `backend\`, with the same `.env`). It reads the servers file or the
   single-server variables, resolves each host and checks that every address is loopback or private (127/8, ::1,
   10/8, 172.16/12, 192.168/16), and stores the tokens encrypted, all in one transaction (any problem
   imports nothing). It is idempotent: a server already in the database is skipped and never overwritten, and an
   existing server keeps the name it has. It refuses a server with no API token, one that sets
   `verifyApiCertificate` / `SATISFACTORY_API_REJECT_UNAUTHORIZED` (that TLS setting is not stored yet), and
   more than 8 servers. A custom `requestTimeoutMs` is not stored either (the 5 s default applies): it warns.
5. Remove the retired config from `backend\.env`: `SATISFACTORY_SERVERS_FILE`, `SATISFACTORY_SERVER_ID`,
   `SATISFACTORY_SERVER_NAME`, `SATISFACTORY_SERVER_HOST`, `SATISFACTORY_API_PORT`, `SATISFACTORY_API_TOKEN`,
   `SATISFACTORY_API_REJECT_UNAUTHORIZED`, `FRM_WEB_PORT`, `FRM_AUTH_TOKEN`, `SATISFACTORY_REQUEST_TIMEOUT_MS`.
   Delete the servers file too (it holds the tokens in plain text). If you forget, the backend starts anyway and logs
   ONE warning naming the ignored variables (names only).
6. Restart and verify: the log says `servers loaded from the database`, `/api/health/ready` answers 200, and the
   dashboard shows every server.

Pinned address: a `localhost` host is stored as the address it resolves to (IPv4 `127.0.0.1` is preferred over
`::1`), and the backend connects to that address, not to the name.

## When a stored server cannot be opened

If the key is missing, is not the one that sealed a row, or a stored value was modified, the backend **stays
up**, serves the servers it can open, and reports **not ready** (`/api/health/ready` 503). The log has one
`error` with `code: "SERVER_CONNECTIONS_UNREADABLE"` listing each server's public id and key id (never a value).
Fix it by restoring the right key (`SERVER_SECRETS_KEY`, or the old one in `SERVER_SECRETS_PREVIOUS_KEYS`), then
restart. If the key is truly gone, the tokens must be entered again (the app's server settings, in a later PR).

## Rotating the key

1. Generate a new key and give it a NEW id: `SERVER_SECRETS_KEY_ID=k2`, `SERVER_SECRETS_KEY=<new>`, and move the old
   one to `SERVER_SECRETS_PREVIOUS_KEYS=k1=<old>`. Back the new key up offline.
2. Restart. Old rows still open (with the old key). Every **edit** of a server re-seals both its tokens with the
   current key. **Re-sealing the old rows can wait**; nothing breaks in the meantime.
3. Only remove an old key from `SERVER_SECRETS_PREVIOUS_KEYS` once no row uses its id:
   `SELECT key_id, count(*) FROM servers.server_connections GROUP BY 1;` (as the admin role).

## Backup and restore

The nightly backup already covers this table, encrypted twice over (tokens sealed by the key, the dump sealed by
age). The **restore rehearsal gains a check** (see the backups runbook): with the backed-up
`SERVER_SECRETS_KEY` in the environment and `DATABASE_URL` pointing at the restored scratch database, run

```powershell
npm run admin -- verify-secrets
```

It opens every stored token and prints how many opened and which servers (by public id and key id) could not. It
never prints a token. It exits 1 if any row cannot be opened, or if there are none to check.

## What this does not change

The frontend, the routes and the API contract are untouched. Adding, editing and removing servers from the app
(operator only) is the next PR; until then the import CLI is the way in.
