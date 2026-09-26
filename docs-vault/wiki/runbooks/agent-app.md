# Runbook: the edge agent program (ADR-0031 PR 6)

The program a player runs on the PC that hosts their Satisfactory server. It reads the game over loopback, pushes
snapshots **out** to the backend, and runs the commands the dashboard asks for (today: the auto-pause setting). It opens
no port: the backend never reaches into the player's network. The backend side is in [`agents.md`](./agents.md).

Source: `agent/` (npm workspace `@satisfactory-dash/agent`). Build: `npm run build -w agent` produces one file,
`agent/dist/agent.cjs`, that runs with Node 22 or newer (`node agent.cjs <command>`). How the file reaches a player (a
release download, a packaged executable) is not decided yet [NEEDS VERIFICATION with the owner]; this page assumes the
file and Node are on the PC.

## First setup, in this order

The order matters. Enrolling makes the dashboard **delete the game tokens it had stored itself** for that server, so the
agent's own token must be set and proven to work before that happens.

1. **Set the game's tokens.** `node agent.cjs set-tokens` asks, at a **hidden prompt** (nothing is echoed), for the game's
   API token and the FicsitRemoteMonitoring (FRM) token (Enter if there is none). They are never accepted as arguments or
   environment variables: command lines and environments are visible to other processes and to process-audit logs. Use a
   different host or ports only if the game is not on this machine's default (`--host 127.0.0.1 --api-port 7777
   --frm-port 8080`); a public host is refused, so a typo cannot send the token across the internet.
   - The API token is an **application token** from the game's `server.GenerateAPIToken` (see
     `docs-vault/wiki/vanilla-dedicated-server-api.md`); the FRM token is the one FRM's own config shows (see
     `docs-vault/wiki/frm-api.md`). Whether FRM enforces its token on this version is [NEEDS VERIFICATION] there.
2. **Check the game.** `node agent.cjs check` reads the status, power, factory, players and the auto-pause setting once and
   prints what works, with counts only (never a save name, a player name or a token). A failure prints a short code
   (`upstream_unreachable`, `upstream_auth_rejected`, `upstream_invalid_response`), never the error text. Fix every failure
   before going on. FRM being absent is not a failure: the dashboard falls back to player counts.
3. **Enrol.** In the dashboard, create an enrolment code for the server (valid 10 minutes, one use). Then
   `node agent.cjs enroll AB3D-7XQ2 --url https://<your backend>`. The address must be `https` (plain `http` only for
   `localhost` while developing) and an origin only, with no path or credentials. The credential the backend returns is
   stored encrypted and never shown again.
4. **Run.** `node agent.cjs run` in a console to watch it, then set it up as a Scheduled Task (below).

`node agent.cjs status` shows what is set up (never a value) and whether the store can be opened.

## Where things are

Under `%LOCALAPPDATA%\satisfactory-dash-agent` (or the folder in `SD_AGENT_HOME`):

- `store.json`: the backend address, the server id, the game's host and ports, and **three secrets, each only as a Windows
  DPAPI blob for the current Windows user**: the agent's credential, the game's API token, the FRM token. A copy on another
  machine or account is useless. What DPAPI does not do: **any process running as the same Windows user can decrypt these
  blobs** (no extra entropy is used, by design of the CurrentUser scope), so it protects against a copied file, not against
  malware already running as you. Keep the data folder inside your own profile (the default does); the folder's permissions
  are what protect the file, and a folder outside your profile (for example under `C:\ProgramData`) may be readable by
  other accounts.
- `halted.json`: present only while the agent is stopped for a permanent reason (see below).
- `logs\agent-YYYY-MM-DD.log`: one JSON line per event, a file per UTC day, the **last 7 days kept**, and a day's file stops
  growing at 5 MB. Only codes and counts are logged: never the credential, the tokens, a snapshot body or a player name
  (the logger enforces this; a secret that somehow reached a line is replaced by `[redacted]`).

## Keeping it running: a Scheduled Task

**The logon type is the trap.** A DPAPI key for the current user exists only in a process that runs as that user with the
user's profile loaded. A task registered as **"Run whether user is logged on or not" with "Do not store password" (S4U)**
does **not** have it [NEEDS VERIFICATION on the owner's Windows build], and the agent then fails at start with exit code 3
and: "Windows could not unprotect the agent's store. Run the agent as the same Windows user that set it up, with a logon type
that loads that user's profile". Use one of these:

- **Run only when the user is logged on** (simplest; the agent runs while that user is signed in, which suits a gaming PC
  that stays signed in):

  ```powershell
  $action    = New-ScheduledTaskAction -Execute "node.exe" -Argument '"<folder>\agent.cjs" run'
  $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings  = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
               -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
  Register-ScheduledTask -TaskName "Satisfactory Dash Agent" -Action $action -Trigger $trigger -Settings $settings -Principal $principal
  ```

- **Run whether the user is logged on or not, with the password stored** (the agent runs before sign-in): create it in the
  Task Scheduler window (Create Task, "Run whether user is logged on or not", leave "Do not store password" **unchecked**,
  and type the account password in the dialog). Do not register it from a script with the password on the command line.
  Whether the profile is loaded for this logon type on the owner's build is [NEEDS VERIFICATION]: run `node agent.cjs status`
  as the task and read the log after the first start.

Either way, run it as **the same Windows user that ran `set-tokens` and `enroll`**. "Start in" the agent's folder, "Stop
the task if it runs longer than" **off**, and "If the task fails, restart every 1 minute". After the first start, read the
newest file in `logs\` for `agent_started`.

**The restart policy and permanent failures.** Two conditions never fix themselves: the backend rejected the credential (exit
2) and the store cannot be unprotected (exit 3). A task that restarts on failure would otherwise start the agent, and
PowerShell, and call the backend again every minute for ever. So the agent, when it meets one, writes a marker
(`halted.json` in the data folder: a reason and a time) and ends with that exit code **once**; every later start prints why
and ends with **success** (exit 0), which the restart policy does not retry. Fix the cause, then clear it: a new enrolment
(`enroll ... --replace`), `set-tokens` or `forget-credential` clear it, and `node agent.cjs resume` clears it by hand (for
example after you changed the task's logon type).

## What it does while running

- **Samples** the game every `min(cadence)` seconds; the backend sets the cadence (today 5 s status and power, 30 s factory)
  and can change it in any answer. It sends the parts that are due, and `settings.autoPause` on each status cadence, **only
  when the game is reachable and the read worked**. A game that cannot be reached sends `reachable: false` and no parts.
- **Never sends what the backend derives**: no circuit status, machine state, counts or units (the backend applies its own
  rules; see [`agents.md`](./agents.md)). It conforms every reading to the backend's input bounds first (strings cut to 200,
  lists capped, float noise clamped, a non-finite number dropped with its entry) so a snapshot is not refused whole.
- **Pushes** snapshots oldest first. While the backend is unreachable it keeps sampling into a **bounded queue** (about 10
  minutes; the oldest is dropped when full) and retries with exponential backoff and jitter. On recovery it sends what is
  left, in order.
- **Runs commands** by long-poll. Every command id is remembered until the command's own expiry, so a command handed out
  twice runs once (the same result is re-reported); an expired command never runs; an unknown command type is reported
  `unsupported`. Results are codes only (`upstream_unreachable`, `upstream_auth_rejected`, `upstream_error`, `unsupported`).
- **Stops on a 401.** If the backend rejects the credential (revoked in the dashboard, or a stale one) the agent stops and
  does not retry: exit code 2 and "Create a new enrolment code there, then run: `agent enroll <CODE> --url <backend>
  --replace`". `forget-credential` removes the stored credential first if you want a clean start.

## What the agent sends (for the player's peace of mind)

Readings of their own game: status, power circuits, machines (names, recipes, rates, positions), the player list (**name and
online flag only**, ADR-0029, live and never stored) and the auto-pause setting, plus its own version. Nothing about the PC:
no host name, address, user name, path or operating system. The HTTP client refuses redirects, so the credential can never
be replayed at another address, and every request has a timeout.

## Troubleshooting

| Sign | Meaning | Do |
|---|---|---|
| exit 3, "could not unprotect the agent's store" | wrong Windows user, or a logon type without the profile | run as the user that set it up; use one of the two task types above; then `resume` |
| exit 2, "rejected this agent's credential" | revoked or replaced in the dashboard | new code, then `enroll ... --replace` |
| "The agent is stopped: ..." and exit 0 | the halted marker from one of the two above | do what it says, then `resume` (or enrol again) |
| `commands_capped`, `command_skipped_expired_or_invalid_expiry` | the backend sent more than 20 commands, or one whose expiry is not about a minute away | nothing; the agent ignores them; check the backend |
| `push_failed` then `push_recovered` in the log | the backend or the network was down | nothing; the queue kept the newest readings |
| `queue_full_dropping_oldest` | a long outage; the oldest readings were dropped | nothing; check the backend |
| `read_failed` with `upstream_unreachable` | the game is not running or the ports are wrong | start the game; `check` |
| `read_failed` with `upstream_auth_rejected` (`auto_pause`) | the API token cannot read or change options | new application token, `set-tokens` |
| `snapshot_refused` | the backend refused a snapshot's shape or size (a bug to report) | report it with the `status` and `code` fields |
| the dashboard says the agent is offline | no snapshot for a while (the alert `agent_offline` fires) | is the PC on, the task running, the log moving? |

## Removing it

Delete the Scheduled Task, run `node agent.cjs forget-credential`, revoke the agent in the dashboard, and delete the data
folder. The game tokens live only in `store.json`, so deleting it removes them too.
