# Runbook: the edge agent on Linux (ADR-0057 Decision 2, step 4)

The same agent program as [`agent-app.md`](./agent-app.md) (read that for what it does, what it sends and the log events),
run as a hardened systemd service on the Linux machine that hosts the Satisfactory server. It reads the game over loopback and
pushes snapshots **out**; it opens no port. This page covers only what differs on Linux. The unit file is
[`agent/packaging/linux/satis-agent.service`](../../../agent/packaging/linux/satis-agent.service).

The unit needs the agent to keep its files under `$STATE_DIRECTORY` (the folder systemd creates for `StateDirectory=`), which
arrived with the Linux secret store (ADR-0057 Decision 2, PR #680). An agent build without it would write under the service
user's home, which the unit makes unwritable.

## The user: a dedicated `satis-agent`, not `DynamicUser=`

`DynamicUser=` exists (system services only, added in systemd 232; `docs-vault/raw-sources/systemd-credentials-2026-10-25.md`,
E3) and would remove the user-creation step. It is not used because the agent's state is **enrolment state you run commands
against by hand** (`set-tokens`, `enroll`, `status`, `resume`) and may need to back up or read for support. A dynamic user's
files move to `/var/lib/private/` with a user that exists only while the service runs, so those commands have no stable
account to run as. A fixed no-login user keeps `/var/lib/satis-agent` owned by one known account, and `sudo -u satis-agent`
works at any time.

## Install

Needs systemd 232 or newer for the directives used, and 254 or newer for the restart back-off (`RestartSteps=`,
`RestartMaxDelaySec=`; an older systemd ignores them with a warning and restarts every `RestartSec=`). The unit was verified
with `systemd-analyze verify` on systemd 257 (Debian 13) and in CI.

1. **Node.** Node 22 or newer at `/usr/local/bin/node` (the unit's `ExecStart=` names this path; edit the unit if yours is
   elsewhere). Use the distribution's package or the official tarball; do not use a version manager's per-user shim, since
   `ProtectHome=yes` hides home folders from the service.
2. **The agent file.** Build `agent/dist/agent.cjs` (`npm run build -w agent`) and copy it to the machine:

   ```sh
   sudo install -d -m 0755 /opt/satis-agent
   sudo install -m 0644 agent.cjs /opt/satis-agent/agent.cjs
   ```

   The file is root-owned and read-only to the service, so a compromised agent cannot rewrite its own code.
3. **The user.**

   ```sh
   sudo useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin satis-agent
   ```

4. **The unit.**

   ```sh
   sudo install -m 0644 satis-agent.service /etc/systemd/system/satis-agent.service
   sudo systemctl daemon-reload
   sudo systemd-analyze verify /etc/systemd/system/satis-agent.service
   ```

   Do not start it yet: it has no credential, and `run` would only report that it is not enrolled.
5. **Set up, in the order of [`agent-app.md`](./agent-app.md) "First setup"** (tokens first, then `check`, then enrol),
   running each command as the service user and pointing it at the state folder:

   ```sh
   sudo install -d -m 0700 -o satis-agent -g satis-agent /var/lib/satis-agent
   sudo -u satis-agent env STATE_DIRECTORY=/var/lib/satis-agent node /opt/satis-agent/agent.cjs set-tokens
   sudo -u satis-agent env STATE_DIRECTORY=/var/lib/satis-agent node /opt/satis-agent/agent.cjs check
   sudo -u satis-agent env STATE_DIRECTORY=/var/lib/satis-agent node /opt/satis-agent/agent.cjs enroll <CODE> --url https://<your backend>
   ```

   `set-tokens` asks at a hidden prompt; the game's tokens are never arguments or environment variables. The enrolment code
   is on the command line (visible in `ps` and shell history), which is acceptable only because it is single-use and valid
   for 10 minutes; start the command with a space if your shell skips history for that. For now the enrolment is the
   existing code path (a code from the dashboard, valid 10 minutes, one use). Pairing by device code when the agent has no
   credential is a later change. The game's host and ports default to loopback `127.0.0.1` / 7777 / 8080; change them only
   with `set-tokens --host ... --api-port ... --frm-port ...`.
6. **Start it.**

   ```sh
   sudo systemctl enable --now satis-agent
   sudo systemctl status satis-agent
   ```

## What the unit does

- `After=network-online.target`, `Restart=on-failure` with `RestartSec=5` growing to 300 s (systemd 254+), and a start limit
  of 10 failures in 10 minutes, after which the unit stays failed until `systemctl reset-failed satis-agent`.
- **Halted state.** The agent's own `halted.json` (a rejected credential, or an unreadable store) is the source of truth for
  "stop retrying": the agent ends **once** with its exit code, and every later start prints why and ends with exit 0, which
  `Restart=on-failure` does not retry. The unit therefore needs no `RestartPreventExitStatus=`. Fix the cause (a new code and
  `enroll ... --replace`, or `set-tokens`), or run `... agent.cjs resume` as the service user, then
  `sudo systemctl restart satis-agent`.
- **Sandbox.** No capabilities, `NoNewPrivileges=`, `ProtectSystem=strict` (the only writable path is the state folder),
  `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`, kernel and cgroup protections, `RestrictAddressFamilies=AF_INET
  AF_INET6 AF_UNIX`, `SystemCallFilter=@system-service`, `MemoryMax=512M`. `MemoryDenyWriteExecute=` is left off on purpose
  (Node's JIT needs writable-executable memory).
- `StateDirectory=satis-agent` makes `/var/lib/satis-agent` (mode 0700, `UMask=0077`) and exports it as `$STATE_DIRECTORY`.
  Back it up with the service stopped, or accept that a copy while it runs may catch `store.json` mid-write.

## Day to day

- **Logs.** `journalctl -u satis-agent -f` for what the process prints, and `/var/lib/satis-agent/logs/agent-YYYY-MM-DD.log`
  for the agent's own JSON lines (7 days). Only codes and counts are logged.
- **Updating is a deliberate action; nothing updates itself.** Copy the new `agent.cjs` over `/opt/satis-agent/agent.cjs`
  (`sudo install -m 0644 -o root -g root agent.cjs /opt/satis-agent/agent.cjs.new`, then `sudo mv` it over the old file), then `sudo systemctl restart satis-agent`. The game server is a
  separate process and stays up.
- **After editing the unit:** `sudo systemctl daemon-reload && sudo systemctl restart satis-agent`.

## Troubleshooting

| Sign | Do |
|---|---|
| `status` shows `failed`, journal says "not enrolled" | do step 5 as the service user, with `STATE_DIRECTORY` set |
| "The agent is stopped: ..." and the unit shows `inactive (dead)` with success | the halted marker: act on the message, then `resume` and restart |
| `start-limit-hit` | `systemctl reset-failed satis-agent`, then fix the cause from the journal |
| permission denied on the state folder | it must be owned by `satis-agent`, mode 0700; commands run by hand must be `sudo -u satis-agent` |
| other signs | the table in [`agent-app.md`](./agent-app.md) |

## Removing it

```sh
sudo systemctl disable --now satis-agent
sudo -u satis-agent env STATE_DIRECTORY=/var/lib/satis-agent node /opt/satis-agent/agent.cjs forget-credential
sudo rm /etc/systemd/system/satis-agent.service
sudo rm -r /opt/satis-agent /var/lib/satis-agent
sudo userdel satis-agent
```

Then revoke the agent in the dashboard. The game tokens live only in the state folder.
