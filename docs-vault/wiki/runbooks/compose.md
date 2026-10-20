# Runbook: the compose stack (ADR-0034 §3, issue #406)

`compose.yaml` at the repo root runs the whole backend on one machine: PostgreSQL 18, a one-off
`migrate` job, the backend, and (in the `tunnel` profile) cloudflared. It is the AWS exit target's
deployment and the PC rehearsal's stack. CI boots it on every PR (`.github/workflows/compose.yml`).

| Service | Image | What it does |
|---|---|---|
| `postgres` | `postgres:18` | Data in the named volume `pgdata`. No published port. |
| `migrate` | the ops image (#404) | On every `up`: `db:init` (roles + database, idempotent), then `db:migrate`. Exits. |
| `backend` | the app image (#404) | Starts only after `migrate` exits 0. Listens on `127.0.0.1:3001` only. |
| `cloudflared` | `cloudflare/cloudflared`, version and digest pinned | `tunnel` profile only. Shares the backend's network namespace. |

Networking (decision D2): nothing publishes a port. cloudflared joins the backend's namespace
(`network_mode: "service:backend"`), so it reaches the backend at `http://127.0.0.1:3001` and connects
from `127.0.0.1`, the one peer `platform/clientIp.ts` trusts for `CF-Connecting-IP`. Never add a
`ports:` entry to the backend or give cloudflared its own network: every visitor would then share one
IP for the login lockout. The stack's own containers reach Postgres by the service name `postgres`.

Every command below runs from the repo root (the folder holding `compose.yaml` and `.env`).

## First time: the `.env` file

```powershell
Copy-Item .env.example .env     # bash: cp .env.example .env
```

Fill it in; `.env.example` says what each key is. `.env` is git-ignored: never commit it, never paste it.

- `POSTGRES_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD`: three **different** hex passwords
  (`openssl rand -hex 24`). Hex, because compose puts them inside `postgres://` URLs.
- `DASHBOARD_ADMIN_PASSWORD_HASH`: from `npm run hash-password -w backend`, **in single quotes**. The hash
  contains `$`, which compose otherwise reads as a variable (and then the login never matches).
- `TUNNEL_TOKEN`: only for the `tunnel` profile (see "Switching the tunnel route").

The game-server keys (`SATISFACTORY_*`, `FRM_*`) are deliberately not passed to the backend: in this
stack servers live in the database and the edge agent pushes their data (`runbooks/servers.md`,
`runbooks/agent-app.md`).

## Start

```powershell
docker compose pull                        # the newest :main images from GHCR
docker compose up -d                       # postgres, migrate, backend; no tunnel
docker compose --profile tunnel up -d      # the same plus cloudflared
docker compose ps -a                       # migrate: Exited (0); backend: Up (healthy)
```

The backend's health check is `GET /api/health/ready` from inside its own namespace. To ask it yourself
(there is no port on the host to curl):

```powershell
docker compose exec backend node -e "fetch('http://127.0.0.1:3001/api/health/ready').then(r=>console.log(r.status))"
```

If `backend` never starts, `migrate` failed: `docker compose logs migrate`. If cloudflared restarts in a
loop, `docker compose logs cloudflared` (an empty or wrong `TUNNEL_TOKEN` says "Provided Tunnel token is
not valid").

To run other image builds (a PR's, or ones built locally), set `APP_IMAGE` and `OPS_IMAGE` in `.env`.

## Stop

```powershell
docker compose --profile tunnel stop       # stop everything, keep containers and data
docker compose --profile tunnel down       # remove the containers, KEEP the pgdata volume
```

`docker compose down -v` also deletes `pgdata`, the whole database. Only on a scratch stack, or right
before a restore you have already downloaded and decrypted.

## Restoring a dump (roles first)

The dump keeps grants to `satis_app`, so the roles `db:init` creates must exist before `pg_restore`
(`runbooks/backups.md`, "Restore rehearsal"). Restore into a **fresh** stack (an empty `pgdata`), never
over a live database. Get and decrypt the dump as `backups.md` describes, into a folder `restore\`
outside the repo, so you have `restore\satis.dump`.

```powershell
docker compose --profile tunnel down                       # backend and tunnel off
docker compose up -d --wait postgres                       # only the database (pgdata must be empty), healthy
docker compose run --rm --no-deps migrate npm run db:init -w backend          # 1. roles + empty database
docker compose run --rm --no-deps -v "<full path to restore folder>:/restore:ro" migrate `
  sh -c 'pg_restore --no-owner --role=satis_migrator --dbname "${DATABASE_ADMIN_URL%/postgres}/satis" /restore/satis.dump'   # 2.
docker compose --profile tunnel up -d                      # 3. migrate runs db:migrate, then the backend
```

Step 2 runs the ops image's PostgreSQL 18 `pg_restore` against the `satis` database, connected as the
`postgres` superuser but creating every object as `satis_migrator` (`--role`). Without `--role` the
tables, `pgmigrations` included, would belong to `postgres`, and step 3's `db:migrate` (which runs as
`satis_migrator`) fails with `relation "pgmigrations" already exists` (checked 2026-10-15 on a dump of
this stack). The single quotes keep your shell from expanding `$`; the container does. In bash, end the
first line with `\` instead of the backtick. Then check the restore as `backups.md` does: `/api/health/ready`
answers 200, a known account can sign in, and with `SERVER_SECRETS_KEY` set the server tokens decrypt.
Delete the `restore` folder afterwards; it holds an unencrypted dump.

## Switching the tunnel route

One public hostname (`api.satis-manager.com`) points at one tunnel. Moving it between the PC's Windows
`cloudflared` service (`runbooks/go-live-api.md`) and this stack's `cloudflared`, either way:

1. Cloudflare dashboard, **Networking > Tunnels**: use a separate tunnel for the compose stack (create it
   once, choose Docker, and copy **only the token** into `.env` as `TUNNEL_TOKEN`; don't run the command
   it shows). Two connectors on one tunnel would split traffic between two backends.
2. On the compose tunnel, the published-application route's service is `http://127.0.0.1:3001`, never
   `localhost` (which can resolve to IPv6 first; the backend is IPv4 loopback only). compose.yaml also
   sets `TUNNEL_URL` to that address for a tunnel with no routes of its own.
3. Start the target side first and check it: `docker compose --profile tunnel up -d` and
   `docker compose ps` (cloudflared Up), or on the PC `Get-Service cloudflared`.
4. Move the hostname: remove the `api` route from the old tunnel, then add it to the new one. Requests
   fail for the moment in between. `[NEEDS VERIFICATION]` whether the dashboard can move a route in one
   step instead.
5. Check from outside: `https://api.satis-manager.com/api/health` answers, then stop the old side
   (`Stop-Service cloudflared` on the PC, or `docker compose stop cloudflared`).

Going back is the same steps in the other direction. The database does not move with the route: switch
only after the stack holds the data you want served (restore first).

## The TLS 1.2 floor (#493)

Clients must never reach the backend over TLS 1.0 or 1.1. The game mod's HTTP client (UE's libcurl) offers 1.0 to
1.3 and can't raise its own floor, so the host refuses the old versions. In the `tunnel` profile TLS ends at your
Cloudflare zone, not in this stack, and a zone's **Minimum TLS Version defaults to 1.0**. Two commands, once per zone:

1. Set the floor. Make an API token with only **Zone > Zone Settings > Edit** on the zone, and copy the zone's id
   from its Overview page. Then:

   ```sh
   CF_API_TOKEN=... CF_ZONE_ID=... npm run tls-floor -- set-cloudflare
   ```

   It prints the value before and after, never lowers it, and does nothing when it's already 1.2 or 1.3. Delete the
   token afterwards if you made it only for this.
2. Check it, after any route or zone change:

   ```sh
   npm run tls-floor -- check <your-api-hostname>
   ```

   It passes only when 1.0 and 1.1 are refused by the server and 1.2 is accepted, and exits non-zero otherwise. It
   lowers its own TLS library's floor for the probes, so a machine that can't offer the old versions reports
   "inconclusive" instead of a false pass.

The official `api.satis-manager.com` passed this check on 2026-10-20 (1.0 and 1.1 refused, 1.2 accepted). The
backend itself never terminates TLS today. A future direct-TLS mode (e.g. LAN, #197) must set `minVersion: "TLSv1.2"`
explicitly and test it.
