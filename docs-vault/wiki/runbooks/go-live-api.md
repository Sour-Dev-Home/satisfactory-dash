# Runbook: turn on the API (backend + Cloudflare Tunnel)

Ordered steps to take the backend from "runs on the dev machine" to "reachable at
`https://api.satis-manager.com`" (ADR-0013). It is the go-live checklist of issue #19 made
concrete. Run everything in **PowerShell 7** (`pwsh`) on the game-server PC, from the repo
root unless a step says otherwise. Commands use `curl.exe` (not the `curl` alias) and put
JSON bodies in temp files, so PowerShell's quoting can't mangle them.

**No secrets in this document or in the repo.** Every value below goes into
`backend\.env` (git-ignored) or is typed at a prompt. Never paste a token or a password
into a chat, an issue or a commit.

The tunnel stays OFF until steps 1 to 4 pass. If any go-live test in step 6 fails, stop the
tunnel (step 7) and report; don't fix it while it's exposed.

## 0. Before you start

- The Windows Firewall inbound **block** rule for TCP 8080 (FRM's plain-HTTP API) is in
  place. Loopback traffic isn't filtered, so the backend still reaches FRM at `127.0.0.1`.
- You have a Cloudflare account that owns `satis-manager.com`.
- Reminder (issue #19): never point a `satis-manager.com` subdomain at a third-party service
  you don't control. The cross-site guard trusts every same-site subdomain.

## 1. Production values in `backend\.env`

Copy `backend\.env.example` to `backend\.env` if you haven't, then set these. Leave
`NODE_ENV` unset (error `detail` is only shown for `development` and `test`), and leave
`HOST` unset so the backend listens on `127.0.0.1` only.

| Variable | How to get the value |
|---|---|
| `DASHBOARD_ADMIN_USER` | The username you'll sign in with. |
| `DASHBOARD_ADMIN_PASSWORD_HASH` | `npm run --silent hash-password -w backend`. It prompts for a password (12+ characters, no echo) and prints one line starting with `scrypt$`. Paste that whole line, never the password. Quotes around the value are optional. |
| `SESSION_SECRET` | At least 32 random bytes. `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))` prints one; copy it into the file. Changing it later signs every session out (and is how a stolen session is revoked). |
| `SATISFACTORY_API_TOKEN` | An **application token**: run `server.GenerateAPIToken` in the game server's console. Application tokens don't expire; `server.InvalidateAPITokens` revokes all of them (`dedicated-server-api.md:279-284`). Don't use a password-login token. |
| `FRM_AUTH_TOKEN` | FRM's token: the value of `FicsitRemoteMonitoring.Server.uWS.AuthenticationToken` in `FactoryGame\Saved\Config\WindowsServer\GameUserSettings.ini` in the server install (`frm-authentication.md`). Rotating it by hand is optional and deferred; ADR-0017 designs the automated version. |
| `CORS_ALLOWED_ORIGINS` | `https://satis-manager.com` (exactly one origin, never `*`). |

The backend refuses to start if a login value is missing, and if the game-server host is
not a loopback or private address.

## 2. Restart the game server WITHOUT AllowInsecureLocalAccess, then prove enforcement

Until now the server has trusted any request from this PC, so nothing proved its tokens
work. Turn that off:

1. Save the game, then stop the dedicated server. Either use the vanilla API (`SaveGame`
   with a `SaveName`, then `Shutdown`) while insecure local access still works, or type
   `server.SaveGame <name>` then `server.Shutdown` in the server's console. The
   `-ini:Engine:[SystemSettings]:FG.DedicatedServer.AllowInsecureLocalAccess=1` argument
   (`dedicated-server-api.md:287-289`) exists only on the running process's command line
   if you started the server by hand; there may be no launcher file to edit. Check the
   running process's command line, or wherever you launch it from (a shortcut, a `.bat`, a
   service), and make sure the new launch does not include it.
2. Start it with a **visible console** so you can see it come up. A launcher script kept
   outside the repo, in the dedicated server install folder, works well:
   `& "<install folder>\FactoryServer.exe" -log` (`-log` opens the console; verified on
   the Windows server). The saved game loads on its own: confirm with `QueryServerState`
   (`isGameRunning` true, the expected session name). Anyone connected is disconnected by
   the restart [NEEDS VERIFICATION: not in docs-vault; assume so].
3. Prove the game API now refuses an unauthenticated call and accepts the token. The token is
   read from `.env` without being printed:

```powershell
$m = Select-String -Path backend\.env -Pattern '^SATISFACTORY_API_TOKEN=(.+)$'
if (-not $m) { throw "SATISFACTORY_API_TOKEN is missing or empty in backend\.env" }
$tok = $m.Matches[0].Groups[1].Value.Trim().Trim('"')
$body = New-TemporaryFile
[IO.File]::WriteAllText($body, '{"function":"GetServerOptions"}')
"no token  : " + (curl.exe -sk -o NUL -w "%{http_code}" -H "Content-Type: application/json" --data-binary "@$body" https://localhost:7777/api/v1)
"with token: " + (curl.exe -sk -o NUL -w "%{http_code}" -H "Content-Type: application/json" -H "Authorization: Bearer $tok" --data-binary "@$body" https://localhost:7777/api/v1)
Remove-Item $body; Remove-Variable tok
```

   Expect `401` (or `403`) without the token and `200` with it. If the no-token call still
   gives `200`, enforcement is not on; go back to item 1 of this section.

4. Same for FRM (`FRM_AUTH_TOKEN`). Verified 2026-09-24: FRM's **read** endpoints
   (`getPower` and the other `get*` pages) answer 200 with no token, a wrong token, or
   from the machine's own LAN address; only certain endpoints check the token. A write
   endpoint does: `POST /sendChatMessage` gave 401 with no token or a wrong token and 200
   with the right one in the `X-FRM-Authorization` header. So the `getPower` check below
   proves the token is *accepted*, not that it is *required*; it will show 200 both ways.
   Keep the Windows Firewall block on TCP 8080 in place.

```powershell
$m = Select-String -Path backend\.env -Pattern '^FRM_AUTH_TOKEN=(.+)$'
if (-not $m) { throw "FRM_AUTH_TOKEN is missing or empty in backend\.env" }
$frm = $m.Matches[0].Groups[1].Value.Trim().Trim('"')
"no token  : " + (curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/getPower)
"with token: " + (curl.exe -s -o NUL -w "%{http_code}" -H "X-FRM-Authorization: $frm" http://127.0.0.1:8080/getPower)
Remove-Variable frm
```

Then build and start the backend (section 3) and run its **flip and restore** check with
enforcement on. Do not skip it: it proves the settings flow works against an enforcing
server. (Run 2026-09-24: login 200, status live, settings `editable: true`, auto-pause
flipped and restored, both 200.) The refused-token path (401/403 mapped to `not_editable`)
stays untested; it needs a run with a deliberately wrong application token.

## 3. Build and run the backend

First make sure nothing else is using port 3001 (a dev server from earlier sessions, for
example): `Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue`
must print nothing. If it prints a row, stop that process (`Stop-Process -Id <OwningProcess>`).

```powershell
npm run build -w backend
Push-Location backend
node dist\server.cjs          # run from backend\ so dotenv finds .env
```

In a second window (also at the repo root): `Invoke-RestMethod http://127.0.0.1:3001/api/health`
should print `status : ok`. The startup log line names the address it bound: it must say
`127.0.0.1`. When you're done with the checks below, stop it with Ctrl+C and run
`Pop-Location` to return to the repo root.

### Verify the backend works with real token enforcement (backend running)

```powershell
$base = "http://127.0.0.1:3001"
# Sign in. The password goes into a temp file that is deleted right after.
$pw = Read-Host "Dashboard password" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $pw).Password
$tmp = New-TemporaryFile; $hdr = New-TemporaryFile
[IO.File]::WriteAllText($tmp, (@{ username = "<DASHBOARD_ADMIN_USER>"; password = $plain } | ConvertTo-Json -Compress))
try {
  $code = curl.exe -s -D $hdr -o NUL -w "%{http_code}" -H "Content-Type: application/json" --data-binary "@$tmp" "$base/api/auth/login"
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue; Remove-Variable plain, pw
}
"login HTTP status: $code"          # expect 200; 401 = wrong user or password
$m = Select-String -Path $hdr -Pattern '^set-cookie:\s*(sd_session=[^;]+)'
Remove-Item $hdr
if (-not $m) { throw "Login failed (HTTP $code); no session cookie. Did you replace <DASHBOARD_ADMIN_USER>?" }
$cookie = $m.Matches[0].Groups[1].Value

# 1. Live data through enforced tokens (FRM + vanilla): expect real values.
curl.exe -s -H "Cookie: $cookie" "$base/api/servers/default/status"

# 2. Settings: editable must be true with an application token.
$s = curl.exe -s -H "Cookie: $cookie" "$base/api/servers/default/settings" | ConvertFrom-Json
$s.data
$orig = [bool]$s.data.autoPause

# 3. Flip and restore the auto-pause setting. ALWAYS finish with the restore.
function Set-AutoPause([bool]$enabled) {
  $f = New-TemporaryFile
  [IO.File]::WriteAllText($f, (@{ enabled = $enabled } | ConvertTo-Json -Compress))
  curl.exe -s -X PUT -H "Cookie: $cookie" -H "Content-Type: application/json" --data-binary "@$f" "$base/api/servers/default/settings/auto-pause"
  Remove-Item $f
}
Set-AutoPause (-not $orig)     # expect data.autoPause to be the opposite of $orig
Set-AutoPause $orig            # restore
curl.exe -s -H "Cookie: $cookie" "$base/api/servers/default/settings"   # expect autoPause = $orig
Remove-Variable cookie, s     # the cookie is a live session token
```

(The cookie and tokens appear on `curl.exe`'s command line while it runs, where other
programs on this PC can see them. That's acceptable on a machine only you use.)

Pass = the status has real numbers, `editable` is `true`, the flip and the restore both
show in the response, and the setting ends where it started. **Record the result**: add it
to ADR-0012 (it resolves the "non-admin token is refused" and enforcement questions) and
tick the item in issue #19. If `editable` is `false`, the token or its privilege is wrong;
fix that before continuing.

Stop the foreground backend (Ctrl+C) before the next step.

## 4. Start the backend automatically at logon

**First stop the section-3 backend** (Ctrl+C in its window, then `Pop-Location` so you're at
the repo root again). If anything still listens on port 3001 the task's process fails with
"address in use". Check, and fail loudly if it does:

```powershell
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
  throw "Port 3001 is still in use; stop that process first"
}
```

```powershell
npm run build -w backend      # if you haven't since the last change
.\scripts\windows\register-backend-task.ps1 -WhatIf     # preview; changes nothing
.\scripts\windows\register-backend-task.ps1 -Start      # registers the task and starts it
Invoke-RestMethod http://127.0.0.1:3001/api/health
Get-Content "$env:LOCALAPPDATA\satisfactory-dash\logs\backend.log" -Tail 5
```

(`-Start` also refuses to start while something else listens on the port, and stops an
already-running task instance first.)

What the task does, and its limits:

- It runs as you (no admin rights), in your session, in a **visible console window**. Closing
  that window stops the backend.
- It starts when **you log on**, not at boot. After a reboot the backend is down until you
  log on, while the `cloudflared` service (which starts at boot) answers 502. If this PC
  must recover by itself, set up Windows auto-logon for your account first.
- If the backend exits with a failure it is restarted **3 times, a minute apart**, then it
  stays down (so a bad `.env` doesn't loop forever). Read the log to see why.
- It runs from `backend\` with `NODE_ENV=production` and appends to
  `%LOCALAPPDATA%\satisfactory-dash\logs\backend.log`, outside the repo. That file grows
  without limit; check its size now and then (rotation is a later improvement).
- Remove it with `.\scripts\windows\unregister-backend-task.ps1`.

**Prove the restart works.** Task Scheduler's own restart-on-failure did NOT restart a
killed backend when tested (2026-09-23), so the task runs `run-backend.ps1`, which restarts
node itself; its lines in the log start with `[run-backend`. Find the backend's node process
and kill it, then wait about 90 seconds.

```powershell
$p = (Get-NetTCPConnection -LocalPort 3001 -State Listen).OwningProcess
Stop-Process -Id $p -Force
Start-Sleep -Seconds 90
Invoke-RestMethod http://127.0.0.1:3001/api/health     # expect status : ok again
```

Kill only the node process on the port, not the `powershell.exe` running `run-backend.ps1`.
The wrapper puts itself in a kill-on-close Job Object, so if it is stopped
(`Stop-ScheduledTask`) node dies with it; without that, a stopped wrapper left node running
and holding port 3001 (tested 2026-09-24). This holds for Windows PowerShell 5.1, which the
task uses; check port 3001 is free after a `Stop-ScheduledTask`. If a leftover backend still
holds the port, `register-backend-task.ps1 -Start` stops it (only a `node.exe` running
`server.cjs`) before starting the task.

If it doesn't come back, the restart isn't working: start it with
`Start-ScheduledTask -TaskName SatisfactoryDashBackend` and tell the architect.

After a rebuild (`npm run build -w backend`), restart the task: `Stop-ScheduledTask
-TaskName SatisfactoryDashBackend; Start-ScheduledTask -TaskName SatisfactoryDashBackend`.

## 5. Create the Cloudflare Tunnel (in the Cloudflare dashboard)

Do this only after steps 1 to 4 pass, and after the ADR-0019 security changes are merged
and running (the backend sends the `no-store` and related headers, and refuses a weak
`SESSION_SECRET`).

0. **Add the login rate-limit rule first** (ADR-0019; the Free plan allows exactly one rate
   limiting rule). In the dashboard for the `satis-manager.com` zone open **Security > WAF >
   Rate limiting rules > Create rule** [NEEDS VERIFICATION: menu labels move; find "rate
   limiting rules" under the zone's security or WAF section]. Name it e.g. `login-rate-limit`:
   - When incoming requests match: **Hostname** equals `api.satis-manager.com` AND **URI Path**
     equals `/api/auth/login`.
   - Characteristics: **IP**. Requests: **5**, period: **10 seconds**.
   - Action: **Block**, duration: **10 seconds**.

   The backend's own 15-minute limits stay authoritative; this only slows guessing at the
   edge. Also make sure there is **no cache rule and no CORS-header rule** on the API
   hostname (the backend sends `Cache-Control: no-store` and its own CORS allowlist).
1. Cloudflare dashboard, the account that owns `satis-manager.com`: **Networking > Tunnels >
   Create a tunnel** (Cloudflared).
2. Name it, then choose **Windows** and run the install command it shows in an
   **administrator** PowerShell. That installs `cloudflared` and runs it as a Windows service.
   Never paste the tunnel token anywhere else.
3. **Routes > Add route > Published application**: subdomain `api`, domain `satis-manager.com`,
   service `http://127.0.0.1:3001` (the backend listens on IPv4 loopback only, and `localhost`
   can resolve to IPv6 first).
4. Confirm the service is running: `Get-Service cloudflared`.

The backend keeps listening only on `127.0.0.1`; the tunnel reaches it from the same machine.

**Emergency: sign everyone out / a cookie was stolen.** Sessions last 8 hours. Logout revokes
that one session, but only until the backend restarts (the denylist is in memory). To revoke
every session at once, put a new `SESSION_SECRET` in `backend\.env`
(`[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))`)
and restart the task (`Stop-ScheduledTask` then `Start-ScheduledTask`, then check port 3001).

## 6. Go-live tests (through the tunnel)

Run these from any machine (every request passes Cloudflare's edge, so the network doesn't
matter). Tell the architect when the tunnel is up; the architect runs the external checks.

```powershell
$api = "https://api.satis-manager.com"

# 6.1 Health through the tunnel: expect 200.
curl.exe -s -o NUL -w "%{http_code}`n" "$api/api/health"

# 6.2 Compression: Cloudflare is expected to compress at the edge (the backend adds none)
#     [NEEDS VERIFICATION: not in docs-vault], so look for a content-encoding header.
curl.exe -s -D - -o NUL -H "Accept-Encoding: gzip, br" "$api/api/health" | Select-String -Pattern "content-encoding"
#     /api/health is only ~15 bytes, and Cloudflare may not compress a body that small, so a
#     missing header there is NOT a failure. Recheck on a larger response, for example the
#     factory route (about 100 KB) with a signed-in cookie, before deciding.

# 6.3 CORS preflight from the site's origin: expect access-control-allow-origin:
#     https://satis-manager.com and access-control-allow-credentials: true.
curl.exe -si -X OPTIONS "$api/api/servers" -H "Origin: https://satis-manager.com" -H "Access-Control-Request-Method: GET" |
  Select-String -Pattern "HTTP/|access-control-allow"
#     ...and from any other origin: expect NO access-control-allow-origin header.
curl.exe -si -X OPTIONS "$api/api/servers" -H "Origin: https://example.invalid" -H "Access-Control-Request-Method: GET" |
  Select-String -Pattern "HTTP/|access-control-allow"

# 6.4 The CF-Connecting-IP spoof test (issue #19). The login lockout trusts this header from
#     the tunnel, so Cloudflare must OVERWRITE a client-sent value. Send a fake one:
curl.exe -s -H "CF-Connecting-IP: 203.0.113.9" "$api/api/health"
#     Your real public address, as Cloudflare sees it (run on the machine you sent from):
(curl.exe -s https://www.cloudflare.com/cdn-cgi/trace | Select-String "^ip=").Line
```

Then, on the game-server PC, read the latest `/api/health` request's log line and look at
its `clientIp` (the raw header itself is also in the log line, so don't search for the fake
address; read the field):

```powershell
Get-Content "$env:LOCALAPPDATA\satisfactory-dash\logs\backend.log" -Tail 100 |
  ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } |
  Where-Object { $_.req.url -eq "/api/health" } | Select-Object -Last 1 |
  Select-Object clientIp, @{ n = "socket"; e = { $_.req.remoteAddress } }
```

- **Pass:** `clientIp` is the real public address printed by the trace, and `socket` is
  `127.0.0.1` (the tunnel). On a machine with both IPv4 and IPv6, the trace and the request
  may have gone out over different ones; if they differ, repeat with `curl.exe -4` and `-6`
  on both.
- **Fail:** `clientIp` is `203.0.113.9`. The spoof survived, so anyone can dodge the login
  lockout. **Stop the tunnel (step 7) and report.** The fallback is a Cloudflare
  rate-limiting rule on `/api/auth/login`.

Also confirm the backend runs directly on this PC and not in a container (a container would
make the tunnel's connections non-loopback, the header would be ignored, and the lockout
would go global again), and that the Vite dev server stays on localhost.

## 7. Rollback

```powershell
Stop-Service cloudflared                       # stops the tunnel at once (admin PowerShell)
```

To remove it completely: run `cloudflared service uninstall` (admin), then delete the tunnel
(or just the route) in the Cloudflare dashboard. To stop the backend too:
`.\scripts\windows\unregister-backend-task.ps1`, then `Get-Process node` and stop the
backend's process.

## After it passes

- Tick each item in issue #19 as it passes, and record the step-2/3 enforcement result in
  ADR-0012.
- The frontend at `https://satis-manager.com` can now sign in against the API.
- Still deferred: rotating the FRM token by hand (ADR-0017 designs the automated version).
