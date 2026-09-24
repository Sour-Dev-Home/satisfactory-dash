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
| `DASHBOARD_ADMIN_PASSWORD_HASH` | `npm run hash-password -w backend`. It prompts for a password (12+ characters, no echo) and prints a hash. Paste the hash, never the password. Quote the value if it contains `$`. |
| `SESSION_SECRET` | At least 32 random bytes. `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))` prints one; copy it into the file. Changing it later signs every session out (and is how a stolen session is revoked). |
| `SATISFACTORY_API_TOKEN` | An **application token**: run `server.GenerateAPIToken` in the game server's console. Application tokens don't expire; `server.InvalidateAPITokens` revokes all of them (`dedicated-server-api.md:279-284`). Don't use a password-login token. |
| `FRM_AUTH_TOKEN` | FRM's token: the value of `FicsitRemoteMonitoring.Server.uWS.AuthenticationToken` in `FactoryGame\Saved\Config\WindowsServer\GameUserSettings.ini` in the server install (`frm-authentication.md`). Rotating it by hand is optional and deferred; ADR-0017 designs the automated version. |
| `CORS_ALLOWED_ORIGINS` | `https://satis-manager.com` (exactly one origin, never `*`). |

The backend refuses to start if a login value is missing, and if the game-server host is
not a loopback or private address.

## 2. Restart the game server WITHOUT AllowInsecureLocalAccess, then prove enforcement

Until now the server has trusted any request from this PC, so nothing proved its tokens
work. Turn that off:

1. Stop the dedicated server. Find how you launch it (a shortcut, a `.bat`, a service) and
   **remove** the `-ini:Engine:[SystemSettings]:FG.DedicatedServer.AllowInsecureLocalAccess=1`
   argument (`dedicated-server-api.md:287-289`). If the setting is in an `Engine.ini` under
   `[SystemSettings]` instead, remove that line. [NEEDS VERIFICATION: how this install sets it.]
2. Start it with a **visible console** so you can see it come up (for the Windows server,
   the `-log` launch argument opens one) [NEEDS VERIFICATION]. Players connected now are
   dropped by the restart.
3. Prove the game API now refuses an unauthenticated call and accepts the token. The token is
   read from `.env` without being printed:

```powershell
$tok = (Select-String -Path backend\.env -Pattern '^SATISFACTORY_API_TOKEN=(.+)$').Matches[0].Groups[1].Value
$body = New-TemporaryFile
[IO.File]::WriteAllText($body, '{"function":"GetServerOptions"}')
"no token  : " + (curl.exe -sk -o NUL -w "%{http_code}" -H "Content-Type: application/json" --data-binary "@$body" https://localhost:7777/api/v1)
"with token: " + (curl.exe -sk -o NUL -w "%{http_code}" -H "Content-Type: application/json" -H "Authorization: Bearer $tok" --data-binary "@$body" https://localhost:7777/api/v1)
Remove-Item $body; Remove-Variable tok
```

   Expect `401` (or `403`) without the token and `200` with it. If the no-token call still
   gives `200`, enforcement is not on; go back to item 1 of this section.

4. Same for FRM (`FRM_AUTH_TOKEN`). [NEEDS VERIFICATION: FRM's behavior with enforcement on.]

```powershell
$frm = (Select-String -Path backend\.env -Pattern '^FRM_AUTH_TOKEN=(.+)$').Matches[0].Groups[1].Value
"no token  : " + (curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/getPower)
"with token: " + (curl.exe -s -o NUL -w "%{http_code}" -H "X-FRM-Authorization: $frm" http://127.0.0.1:8080/getPower)
Remove-Variable frm
```

Then build and start the backend (section 3) and run its **flip and restore** check with
enforcement on. Do not skip it: it settles ADR-0012's open question (a refused token gets
401/403, which the backend maps to `not_editable`).

## 3. Build and run the backend

```powershell
npm run build -w backend
Set-Location backend
node dist\server.cjs          # run from backend\ so dotenv finds .env
```

In a second window: `Invoke-RestMethod http://127.0.0.1:3001/api/health` should print
`status : ok`. The startup log line names the address it bound: it must say `127.0.0.1`.

### Verify the backend works with real token enforcement (backend running)

```powershell
$base = "http://127.0.0.1:3001"
# Sign in. The password goes into a temp file that is deleted right after.
$pw = Read-Host "Dashboard password" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $pw).Password
$tmp = New-TemporaryFile; $hdr = New-TemporaryFile
[IO.File]::WriteAllText($tmp, (@{ username = "<DASHBOARD_ADMIN_USER>"; password = $plain } | ConvertTo-Json -Compress))
curl.exe -s -D $hdr -o NUL -H "Content-Type: application/json" --data-binary "@$tmp" "$base/api/auth/login"
Remove-Item $tmp; Remove-Variable plain, pw
$cookie = (Select-String -Path $hdr -Pattern '^set-cookie:\s*(sd_session=[^;]+)').Matches[0].Groups[1].Value
Remove-Item $hdr

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
```

Pass = the status has real numbers, `editable` is `true`, the flip and the restore both
show in the response, and the setting ends where it started. **Record the result**: add it
to ADR-0012 (it resolves the "non-admin token is refused" and enforcement questions) and
tick the item in issue #19. If `editable` is `false`, the token or its privilege is wrong;
fix that before continuing.

Stop the foreground backend (Ctrl+C) before the next step.

## 4. Start the backend automatically at logon

```powershell
npm run build -w backend      # if you haven't since the last change
.\scripts\windows\register-backend-task.ps1 -WhatIf     # preview; changes nothing
.\scripts\windows\register-backend-task.ps1 -Start      # registers the task and starts it
Invoke-RestMethod http://127.0.0.1:3001/api/health
Get-Content "$env:LOCALAPPDATA\satisfactory-dash\logs\backend.log" -Tail 5
```

The task runs as you (no admin rights), starts at logon, restarts if it exits with a
failure, runs from `backend\` and appends to a log file outside the repo. The log grows
without limit; check its size now and then (rotation is a later improvement). Remove it
with `.\scripts\windows\unregister-backend-task.ps1`.

After a rebuild (`npm run build -w backend`), restart it: `Stop-ScheduledTask -TaskName
SatisfactoryDashBackend; Start-ScheduledTask -TaskName SatisfactoryDashBackend`.

## 5. Create the Cloudflare Tunnel (in the Cloudflare dashboard)

Do this only after steps 1 to 4 pass.

1. Cloudflare dashboard, the account that owns `satis-manager.com`: **Networking > Tunnels >
   Create a tunnel** (Cloudflared).
2. Name it, then choose **Windows** and run the install command it shows in an
   **administrator** PowerShell. That installs `cloudflared` and runs it as a Windows service.
   Never paste the tunnel token anywhere else.
3. **Routes > Add route > Published application**: subdomain `api`, domain `satis-manager.com`,
   service `http://localhost:3001`.
4. Confirm the service is running: `Get-Service cloudflared`.

The backend keeps listening only on `127.0.0.1`; the tunnel reaches it from the same machine.

## 6. Go-live tests (through the tunnel)

Run these from any machine (every request passes Cloudflare's edge, so the network doesn't
matter). Tell the architect when the tunnel is up; the architect runs the external checks.

```powershell
$api = "https://api.satis-manager.com"

# 6.1 Health through the tunnel: expect 200.
curl.exe -s -o NUL -w "%{http_code}`n" "$api/api/health"

# 6.2 Compression: expect a content-encoding header (Cloudflare compresses at the edge;
#     the backend adds none).
curl.exe -sI -H "Accept-Encoding: gzip, br" "$api/api/health" | Select-String -Pattern "content-encoding"

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

Then, on the game-server PC, read that request's log line and check its `clientIp`:

```powershell
Get-Content "$env:LOCALAPPDATA\satisfactory-dash\logs\backend.log" -Tail 20 | Select-String "clientIp"
```

- **Pass:** `clientIp` is the real public address printed by the trace, and `req.remoteAddress`
  is `127.0.0.1` (the tunnel).
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
