# Runbook: the owner's switch-over to the edge agent (ADR-0031 PR 8)

The owner's real server is a `local` server today: the backend, running on the game PC, reads the game itself with the
tokens it holds. This page moves it to the **agent** model (a small program on the same PC pushes readings out to the
backend), with a parity week to prove nothing was lost, and says what the way back is. Read
[`agent-app.md`](./agent-app.md) (the program: setup, files, the Scheduled Task) and [`agents.md`](./agents.md) (the backend
side) first; this page is only the order of doing it.

## Before you start (checklist)

- The backend that is running has PRs 5a, 5b and the agent-input contract deployed and **`npm run db:migrate` has been
  run** (the agent tables, commands and the `agent_offline` rule kind). The dashboard's Settings page has the Agent
  section (frontend PR 7).
- The alert engine is in the state you want for the week: **`ALERT_DELIVERY=off` while you compare** (alerts are recorded
  and nothing is sent), see [`alerts.md`](./alerts.md). Turn it on afterwards.
- You can sign in as the operator (the account that manages servers) and you have the game PC's desktop or a remote session
  as the **same Windows user** that will run the agent.
- Write down the baseline (below) BEFORE enrolling: the local server's last week of history and alerts is what the agent
  week is compared against. The server keeps its id, its members and its history across the switch (history is stored per
  server, whatever reads it), so both weeks sit in the same charts.

## 1. Put the agent on the PC

In the repository checkout on the game PC (ADR-0031: run from the checkout until there is a first other player):

1. `git pull`, `npm ci`, `npm run build -w agent`.
2. Check it runs: `node agent\dist\agent.cjs --version`.

Do not create the Scheduled Task yet: enrol first (step 3), so the first run has something to run.

## 2. Set the game's tokens and check the game (the agent's own, not the backend's)

The order matters (enrolling makes the backend **delete the game tokens it stored itself**):

1. `node agent\dist\agent.cjs set-tokens` and paste the game's API token and the FRM token at the hidden prompts. Use a
   token the AGENT owns: generate a fresh application token in the game (`server.GenerateAPIToken`, see
   `docs-vault/wiki/vanilla-dedicated-server-api.md`) rather than reusing the backend's, so the two can be revoked
   independently later.
2. `node agent\dist\agent.cjs check`. Every line must be `ok` (FRM "not available" is fine if you never had FRM). Do not
   go on until it is.

## 3. Enrol

1. In the dashboard: **Settings, Agent section**, choose the server, create an **enrolment code** (valid 10 minutes, one use).
2. On the PC: `node agent\dist\agent.cjs enroll <CODE> --url https://<your backend address>`. This trades the code for the
   agent's credential (stored encrypted for your Windows user) **and the backend deletes its own stored connection for this
   server and switches it to an agent server**. From this moment the backend no longer polls the game itself.
3. Create the Scheduled Task exactly as `agent-app.md` says ("Keeping it running"): **logged-on** or **stored-password**
   logon type, **never S4U**, the same Windows user as `set-tokens`, action
   `node "<checkout>\agent\dist\agent.cjs" run`, restart on failure. Start it and read the newest file in the agent's
   `logs\` folder for `agent_started`.
4. In the dashboard the Agent section shows the agent **online**, and the live pages (status, power, factory, players) fill
   in within a few seconds. The alert list shows the `agent_offline` rule for the server.

There is a gap of a few seconds to a minute between enrolling and the first snapshot: one missing history sample, no more.

## 4. The parity week

Compare, for the week after the switch against the week before (the same charts hold both, because the server id and its
history are kept):

| What | Where | Same means |
|---|---|---|
| Power history (per circuit, MW) | dashboard Power tab; history queries in [`history.md`](./history.md) | the same shape and range, no new gaps except the switch minute, samples on the agent cadence (5 s status/power, 30 s factory) |
| Item rates and machine transitions | dashboard Production tab; `history.md` | the same items and roughly the same rates; transitions (producing, underfed, backedUp, paused, unpowered) in similar numbers per day |
| Machine states and overflow count | Overview, Production | the same counts for the same factory (the backend derives them for an agent with the same rules as for a polled server) |
| Alerts | the alert log ([`alerts.md`](./alerts.md), the SQL to read it) | the same kinds firing for the same causes; any `server_unreachable` or `agent_offline` events explained (PC off, network, task not running) |
| Pause and auto-pause | Settings, the auto-pause toggle | the value shown matches the game; a change takes effect within a minute and shows its result (it is a command the agent runs) |
| Agent health | the Agent section, the agent's own log | `online` almost always true; no `push_failed` streaks longer than a network blip; no `halted` marker |

Known, expected differences: a stored factory reading keeps the states derived when it arrived, so a fuse that trips shows
on machines at the next factory snapshot (30 s), not at once (documented in `agents.md`); readings are conformed to the
backend's input bounds (a value out of range is clamped, never sent as garbage).

If something is wrong, do not wait out the week: see "The way back" below.

## 5. Retire the local connection

After a clean week:

1. The backend's stored connection for the server is already gone (enrolling deleted it). Confirm in the dashboard's
   management list that the server appears as an **agent** server and can be renamed.
2. Remove any leftover **environment** server configuration on the backend host (`SATISFACTORY_*` variables, the servers
   file): with a database the backend does not use them (issue #196), and the servers file holds tokens in plain text
   ([`servers.md`](./servers.md)).
3. Revoke the game token the backend used to hold, in the game, so only the agent's token remains valid
   [NEEDS VERIFICATION: how a single application token is revoked in-game on this version; regenerating the admin
   credential invalidates all, see the vanilla API notes].
4. Turn `ALERT_DELIVERY=on` if the shadow run was clean ([`alerts.md`](./alerts.md)).

## The way back

- **Stop the agent** (Stop-ScheduledTask; the dashboard then shows it offline and `agent_offline` fires when delivery is on).
- **Revoke it** in the dashboard (Agent section): the credential stops working at once; a running agent gets a 401 and halts
  by itself (exit 2, marker, then quiet).
- **Back to a backend-polled server**: `POST /api/servers/:serverId/local-connection` (operator only; ADR-0031 amendment 2,
  the dashboard's "Switch back to local" card is the frontend's) with the game server's address and tokens, exactly as when
  adding a server. The backend tests the connection first, then in one step makes the server `local` again, stores the
  connection, revokes the agent's credential, drops unspent enrolment codes and ends waiting commands as `expired`. Members
  and history stay (they hang on the server's internal id). It answers `server_not_agent` (409) for a server that is not
  reached through an agent. Afterwards **stop the agent** on the game PC (Stop-ScheduledTask); a running one gets a 401 and
  halts by itself. If you revoked the agent first, the same call still works: the server just has no data until it runs.
  See [`servers.md`](./servers.md).
- **Re-enrol the same server** (new code in Settings, `enroll ... --replace`): works at any time, for a lost credential, a
  revoked one, a new PC or a reinstall; history and members are unchanged.

## Troubleshooting the switch itself

| Sign | Meaning | Do |
|---|---|---|
| Agent section says not enrolled after `enroll` succeeded | the enrol call went to another backend, or the code was for another server | `agent status` shows the backend and server id the agent uses; compare with the dashboard |
| online false right after start | first snapshot not yet received (also after a backend restart) | wait a minute; then the agent's log (`push_failed`, `auth_rejected`) |
| `halted` message at start | a permanent failure earlier (credential rejected, store unreadable) | `agent-app.md`, "The restart policy and permanent failures" |
| the server vanished from the dashboard list | it was removed, or the backend restarted without its database | the managed list (operator) shows agent servers too; check the backend log |
