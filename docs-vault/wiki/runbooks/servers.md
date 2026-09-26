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
The stored address is also re-checked at every start: a row whose address is not loopback or private (say, edited in
the database by hand) is not served either, with `code: "SERVER_CONNECTIONS_REFUSED"` and the same not-ready answer.
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

## Managing servers through the API (operator only)

The backend now has routes to add, edit, test and remove servers (the app's screen for them is a separate change;
until then they can be called with the operator's session). **Only the seeded operator account may use them**: being
the owner or an admin of a server is not enough (403). `GET /api/servers` says `canManageServers: true` for the operator.

| Route | What it does |
|---|---|
| `POST /api/servers` | Add a server (`id`, `displayName`, `host`, `apiPort`, `frmPort`, `apiToken`, optional `frmToken`). 201. |
| `GET /api/servers/managed` | Every stored connection, including the ones this backend is not serving (`state`: `ok`, `unreadable` or `refused`), with host, ports and the token flags. Members' `GET /api/servers` is unchanged. |
| `POST /api/servers/test-connection` | Try entered values before saving. Always 200; `ok: false` names the failing side by code. |
| `GET /api/servers/:serverId/connection` | The stored connection for the edit form: host, ports, `set` flags and the last 4 characters of each token. |
| `PATCH /api/servers/:serverId` | Change any of the fields (`frmToken: null` clears the FRM token). |
| `DELETE /api/servers/:serverId` | Remove: the memberships and the encrypted tokens are wiped and the pollers stop. |
| `POST /api/servers/:serverId/test-connection` | Test the stored connection (the tokens are write-only, so they cannot be resent). |

Rules the routes enforce:

- **The host must resolve only to loopback or private addresses** (127/8, ::1, 10/8, 172.16/12, 192.168/16; IPv4-mapped
  IPv6 by its IPv4). One public, link-local (169.254/16, including the cloud metadata address), CGNAT, multicast or
  unique-local address among the answers refuses the whole host (`address_not_allowed`, 422; the message never names the
  address). The host is checked again on every edit and every test, and the backend connects to the pinned address.
- **A test connection must pass before anything is saved** (`connection_test_failed`, 422): the vanilla API's
  `QueryServerState` and FRM's `getSessionInfo`. The result carries codes only (`unreachable`, `unauthorized`,
  `invalid_response`), never a message from the game server.
- **At most 8 servers** (`server_limit_reached`, 409), and an id that is taken is `server_exists` (409). Create never
  overwrites; edits go through `PATCH`.
- **Tokens are write-only.** A request may carry them; no response ever does. A token must be printable ASCII without
  spaces, and an empty FRM token is refused (omit it, or send `null` on an edit).
- **Import first.** While servers still come from the environment (the servers file or the single-server variables) and
  none is stored, adding one is refused with `import_required` (409): the next restart would let the database win and
  silently drop the environment's servers. Run `npm run admin -- import-servers`, remove the variables, then add more.
- **Remove needs no key.** An unreadable row (or one on a backend with no `SERVER_SECRETS_KEY`) can still be removed.
- **`state: "refused"`**: a stored address that is not loopback or private (e.g. edited in the database by hand). The
  backend does not connect to it, not even to test it. Edit the host (it is re-resolved and re-pinned), or remove it.
- **A row whose tokens cannot be opened** is `state: "unreadable"` on `GET .../connection` and in the list; a `PATCH` that carries
  BOTH tokens (the FRM token may be `null`) repairs it, and anything less is `connection_unreadable` (409).
- **The plain-HTTP warning**: for any address that is not loopback the response has `plainHttpOverLan: true`. FRM has
  no TLS, so its token (and data) cross the LAN in clear text, and anyone on the LAN could read it. The owner accepted
  this trade-off (ADR-0030); the screen shows it whenever a non-loopback host is entered.
- **Known limits, accepted with the design (ADR-0030).**
  - The vanilla API's self-signed certificate is not verified for a loopback or private host, so on a LAN the API
    token could be taken by someone who can impersonate that machine (ARP spoofing). `plainHttpOverLan` covers FRM only.
  - The operator chooses the ports, so a test connection tells them whether something answers on any port of an
    allowed address (open, refusing, or not a game server), by code only and never with the response. Only the operator
    can do this, and only against loopback or private addresses.
  - Redirects are never followed (a 3xx from a game server is a failed test): the address guard checks the first hop
    only, and a redirect would carry the FRM token to wherever it points.
- **One change at a time**, in this process (a mutex) and across processes (a Postgres advisory lock around the count
  and the insert). Writes are limited to 30 per 15 minutes per user, test connections to 10 per minute.
- **Audit**: `server.created`, `server.updated` (the names of the changed fields, never values) and `server.deleted`.
