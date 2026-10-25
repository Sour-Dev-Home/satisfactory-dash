# ADR-0057: Hosting coverage: the dashboard on as many server hosting types as possible, Linux self-hosting first

Status: **proposed** (the owner accepts it by approving the PR and answering the questions at the end). Written at the owner's
request (2026-10-25): "ideally my board just works with as many hosting types as possible so we need to research how to
do that". The owner also approved the same day: start with Linux self-hosters, write this ADR first, and rehearse on a
homelab Linux VM (Debian 13, 8 vCPU, 16 GB) with a Linux dedicated server, SML, FRM and a Linux agent paired with the
**staging** backend only: never production, no production secrets on homelab devices, nothing in CI or the product may
depend on the VM, and no host names or IPs in this repository. Nothing here is built until the owner answers.

Evidence is cited to `raw-sources/`; anything not captured is **[NEEDS VERIFICATION]**. New captures for this ADR:
`game-hosts-panels-2026-10-25.md` (hosts), `linux-server-docker-pterodactyl-2026-10-25.md` (Linux server, Docker image,
Pterodactyl egg, ficsit.app Linux targets), `systemd-credentials-2026-10-25.md` (secret store). Short forms below:
`linux-...` is the second file and `panels` is the first.

## Context

### What exists
- **One connection kind covers every mode so far.** Any program that posts the `/agent/v1` contract (enrol with a
  single-use code, per-server credential, snapshot push, command long-poll) is "an agent" to the backend (ADR-0031 §2).
  The mod is "just another agent", `agentVersion: "mod/x.y"` (ADR-0039 Decision 2, ADR-0042 Decision). The backend needs no change
  for a new transport: this ADR is about which program runs where, not a new protocol.
- **The agent is a Windows program only in a few places.** It reads the game over loopback with
  `packages/game-adapter`, opens no port (`agent/CLAUDE.md:5`), and imports only `node:*`, zod and two workspace packages
  (`agent/CLAUDE.md:9-11`). The Windows-only parts: the secret store, `agent/src/dpapi.ts` (shells out to PowerShell;
  off Windows every call throws `unavailable`, `dpapi.ts:92-100`), the Scheduled Task runbook
  (`runbooks/agent-app.md:58-97`), and the Electron Server Manager (ADR-0040). The data directory already falls back to
  `~/.satisfactory-dash-agent` off Windows (`store.ts:42-48`), and the secret store is already an interface
  (`Dpapi { protect, unprotect }`, `dpapi.ts:31-36`) injected through `AgentStore.open(dir, dpapi)` (`cli.ts:171`).
  CI already runs the agent's tests on Linux and skips the DPAPI round trips (`agent/CLAUDE.md:28`).
- **FRM being absent is already handled.** The sampler treats it as `available: false`, never a throw
  (`agent/src/sampler.ts:16`), and the snapshot's sections are optional (ADR-0031 §2: `status?, power?, factory?,
  players?`). Whether the backend and UI show a sensible page for a vanilla-only server is [NEEDS VERIFICATION] (Decision 2,
  step 1 below).
- **The agent refuses a non-local game host on purpose.** `isAllowedGameHost` accepts a loopback name or a loopback,
  private or link-local IP literal, and refuses anything else, including a container service name, "so a typo cannot
  send the token across the internet" (`store.ts:50-58`). This matters for Docker (below) and for a relay.
- **Staging is a throwaway task, not a service.** CI starts one ECS task with its own PostgreSQL behind a Cloudflare
  Access application (the owner's identity plus one service token CI sends), tests it, and stops it
  (ADR-0049 D3: "No service and no idle cost"). A long-running rehearsal agent cannot pair with it as built; see the
  rehearsal plan.
- **The mod is underway and wants to replace the Node agent.** ADR-0042 builds the core mod v1 for every host that runs
  mods, and its sub-project 5 deprecates the Node agent after parity. Its Linux build is in sub-project 4 (CI builds for
  Windows and Linux). This ADR argues the agent should not be deprecated (Decision 1).

### What the game, FRM and SML give on Linux (cited)
- A Linux dedicated server exists: x86-64 only, "no 32-bit (x86) or ARM support", a `kvm64` VM CPU "won't work", 8 GB RAM
  minimum and 16 GB for larger saves, installed with SteamCMD app 1690800 and started with `./FactoryServer.sh`
  (`linux-server-docker-pterodactyl-2026-10-25.md` E1, E2). A Raspberry Pi cannot host the game; it can host a relay.
- The ports are 7777 TCP (HTTPS API) and UDP (game and the Lightweight Query API) and 8888 TCP
  (`dedicated-server-ports-2026-10-19.md` E1). FRM says the game's TCP port "is required to be accessible for normal
  gameplay" (`frm-dedicated-server.md` E2): **the vanilla API's port is reachable on every host that has players.**
  FRM's web server is a separate port, default 8080 (`frm-config-port-1.5.4-2026-10-20.md` E3).
- SML 3.12.0 and FRM 1.5.4 both publish a `LinuxServer` target on ficsit.app; FRM 1.5.4 needs game build >= 513885
  (`linux-server-docker-pterodactyl-2026-10-25.md` E5). FRM's Linux config file is
  `FactoryGame/Saved/Config/LinuxServer/GameUserSettings.ini` (`frm-config-port-1.5.4-2026-10-20.md` E2).
- The vanilla API needs a Bearer token (application tokens, issued with the console command `server.GenerateAPIToken`),
  or no token for loopback with `FG.DedicatedServer.AllowInsecureLocalAccess=1` (`dedicated-server-api.md` E5); the HTTPS
  certificate is self-signed unless the owner supplies one (E3). Third-party apps "should NOT use PasswordLogin"
  (E5). How a player on a host without a console obtains a token is [NEEDS VERIFICATION] (the API lists a `RunCommand`
  function, `dedicated-server-api.md` header; whether it can issue the token is not captured).
- What the vanilla API alone gives: server name and session, connected players and limit, tech tier, active schematic,
  game phase, run time, paused, average tick rate, health (`dedicated-server-api.md` E6, E8), plus options and saves
  (E9; `dedicated-server-api-saves-2026-10-20.md`). It gives no power, production, factory or player positions: those
  are FRM (`data-gap-analysis.md`).

## Hosting types: what access each gives

"Stated" means a captured page says it; blank-cell entries are **[NEEDS VERIFICATION]**. No host's page, among the seven
read, says whether the game process may open outbound connections (`game-hosts-mods-2026-10-20.md` header,
`game-hosts-panels-2026-10-25.md`).

| Type | Shell | Files | Mods | Extra port (FRM) | Own process / startup | Outbound from game |
|---|---|---|---|---|---|---|
| Self-hosted Windows | yes (owner's PC) | yes | yes | yes (own firewall) | yes | yes |
| Self-hosted Linux / unmanaged VPS | yes (the wiki's install is a shell recipe, `linux-...` E1) | yes | yes; Linux targets exist (E5) | yes (own firewall) | yes (systemd) | yes |
| Docker, self-run (e.g. the robtme image) | on the Docker host | volumes (`/config`, `/saved`...) | "rough around the edges, but they do now work" (E3) | publish it yourself | a second container | yes (Docker default) [NEEDS VERIFICATION: no source captured] |
| Pterodactyl-egg panel hosts | not stated on any page | SFTP (Nodecraft, port 2022: panels E3) | via SMM over SFTP, or a panel mod manager (`game-hosts-mods-2026-10-20.md` E1-E10) | host-controlled: modding docs call it "bonus points" (panels E1); "Most hosts default-block non-game ports" (panels E4) | the egg fixes the startup command (`linux-...` E4); a second process: not stated | not stated |
| FTP-only or limited panels (G-Portal, Nitrado, 4netplayers, dawnserver) | not stated | FTP only, no Mod Manager (G-Portal, panels E2) | G-Portal: manual upload of the Windows Server build; Nitrado: FTP "invalid response"; 4netplayers and dawnserver: unsupported (`sml-dedicated-server-setup.md`, "Unsupported Hosts") | not stated | not stated | not stated |

Which of these hosts run Pterodactyl is not stated on their pages; the row groups hosts that document SFTP plus SMM.
Shockbyte and Nitrado could not be captured (panels header); Shockbyte reached only through a search summary that says
it uses SMM over SFTP: [NEEDS VERIFICATION].

## Connection modes

| Mode | Where it runs | What the host must allow | Security posture | Data | Effort | AWS cost |
|---|---|---|---|---|---|---|
| **(a) Agent beside the server** (Windows today; Linux; Docker sidecar) | on the game machine, outbound only | a shell or a second container | unchanged: no inbound port, game tokens stay local (ADR-0031) | full: vanilla + FRM | Windows done; Linux small (below) | none |
| **(b) Our SML mod** (ADR-0042) | inside the game process, outbound only | mods + outbound HTTPS | credential in a file in the server dir that the host's staff and SFTP users can read; ADR-0045 is the threat model | status, power, auto-pause native in v1; factory, map, world through FRM on the same host over loopback, so no extra port is needed (ADR-0042 Context) | large, already approved and underway | none |
| **(c) Relay agent** the player runs elsewhere | the player's PC or a Pi, reading the game's ports over the internet | port 7777 reachable (always); FRM's port only if the host opens it | the admin-level API token and FRM's plain-HTTP, tokenless read API cross the internet; needs certificate pinning (the self-signed cert, `dedicated-server-api.md` E3) and breaks the agent's local-host-only guard (`store.ts:50-58`); no new inbound path to us | vanilla always; FRM only with its port open | medium: pinning, opt-in guard, docs | none |
| **(d) Backend pulls** the exposed API with a token | our ECS task | port 7777 (and 8080) reachable from AWS | **reverses ADR-0031's two rules**: the cloud would store admin-level game tokens for every server and make outbound requests to player-supplied addresses (an SSRF surface: allow-list, DNS pinning, private-range refusal), and each viewer-driven read lands on the game thread (`frm-dedicated-server.md` E3). Needs the owner's explicit approval | vanilla; FRM if exposed | medium-large, plus a security review | outbound traffic from the ECS task to every player's host: [NEEDS VERIFICATION] against the Free-plan limits |
| **(e) Vanilla-only tier** | a data tier delivered by (a), (b), (c) or (d), not a transport | nothing beyond 7777 | as the carrier | health, state, players count, tick rate, options, saves (list above) | small: label the UI | none |

The security-sensitive facts are why (d) is not recommended and (c) is deferred: today the cloud holds no game token and
has no path into any player's network (ADR-0031 Consequences). Modes (a) and (b) keep that. A relay keeps it too (the
token lives with the relay's owner) but puts the token and unauthenticated FRM data on the public internet between the
relay and the host.

## Coverage matrix (recommended)

| Host type | Mode | Data available | Status |
|---|---|---|---|
| Self-hosted Windows | (a) Windows agent; later (b) | full | done (ADR-0031); keep |
| Self-hosted Linux / unmanaged VPS | (a) **Linux agent** | full | **first build** |
| Docker, self-run | (a) **agent container beside the game container**; or (b) when the mod is released | full when FRM is installed in the image, else vanilla-only | second build |
| Panel host with SFTP + mods | (b) mod (needs outbound allowed: ask) | status, power, auto-pause; factory/map/world once the FRM bridge ships | ADR-0042 order; Linux target in its sub-project 4 |
| Panel host with SFTP, no outbound or no mods | (c) relay, only if a token can be obtained | vanilla-only | deferred until a player needs it |
| FTP-only / limited panels | (c) relay, same condition; else not supported | vanilla-only at best | deferred; document as "not supported" meanwhile |
| Any host, nothing installable, no token | none | not supported | say so plainly in the docs |

## Decision

### 1. Keep the Node agent as the "you control a process" path; the mod is the "you don't" path
Amend ADR-0042 sub-project 5: the Node agent is **not** deprecated at parity. Reasons: the mod needs a UE toolchain, a
rebuild per game/SML release (`mod-maintenance.md`) and per-host approval of outbound traffic, none of which the agent
needs; the Linux agent is a small delta on a working program; and Docker, Linux VPS and relay hosts need an agent
whether or not the mod exists. Both stay on the one `/agent/v1` contract, so there is no duplicated backend.

### 2. Build order (smallest first; each is a separate PR, no stacking)
1. **Contract and backend: nothing** (checked: the agent kind is transport-agnostic). One check PR is allowed: a
   vanilla-only server (no `power`, no `factory`) shows a clear "basic data" state instead of an error or empty charts
   (owner: `backend`/`frontend` sessions; the test is a fixture with only `status`). Trigger: before the first
   non-FRM user; cheap now.
2. **`agent/` secret store seam** (owner: dev session for `agent/`): rename the `Dpapi` interface to a platform-neutral
   `SecretBox` with `protect`/`unprotect` (same shape, so `AgentStore` is unchanged) and add `fileSecretBox`: base64 or
   plain secrets in the agent's state directory, file mode 0600 in a 0700 directory, written atomically, refusing to
   start when the mode is looser than 0600 or the file is a symlink (like an SSH key). Selection by platform
   (`win32` = DPAPI, else file) and an explicit `SD_AGENT_SECRET_STORE` override. Update `agent/CLAUDE.md`'s "secrets only as
   DPAPI blobs" rule to "only in the platform's store". Proof: unit tests on the ubuntu CI job for mode, atomic write,
   symlink refusal and a loud error on a loose file; the DPAPI tests are unchanged.
3. **State directory and service paths**: `resolveDataDir` also honours `STATE_DIRECTORY` (set by systemd) before the
   home-folder fallback; proof: extend `store.test.ts`.
4. **systemd unit and runbook** (`runbooks/agent-linux.md`; the unit file lives under `agent/packaging/linux/`): a dedicated
   no-login user or `DynamicUser=` (system services only, added in systemd 232, `systemd-credentials-2026-10-25.md` E3),
   `StateDirectory=`, `NoNewPrivileges=`, `ProtectSystem=strict`, `ProtectHome=`, `PrivateTmp=`, `Restart=on-failure` with a
   back-off, and `After=network-online.target`. The agent's own halted-state logic (`halted.ts`) stays the source of
   truth for "stop retrying". Proof: `systemd-analyze verify` on the unit in CI (ubuntu runner) and the rehearsal.
5. **Packaging**: a container image on GHCR (public repo, free; amd64 and arm64, arm64 only for a relay Pi because the game
   itself has no ARM support, `linux-...` E1) and a release tarball with `agent.cjs`, the unit and an install script that
   requires the repo's Node version. Not now: a `.deb`/`.rpm`, a Node single-executable build, a signed update check
   (ADR-0031's phase-2 trigger, the first player other than the owner, still governs).
6. **Docker sidecar**: a compose example where the agent shares the game container's network
   (`network_mode: "service:<game>"`), so the agent reaches the game at `127.0.0.1`, which `isAllowedGameHost` already
   allows. The alternative, a service name, would need a guard change and is not recommended. For the vanilla token in
   a container: `AllowInsecureLocalAccess=1` is documented for loopback (`dedicated-server-api.md` E5) and is safe only
   because the shared network namespace is not published; whether the image's `/config` lets the argument be passed is
   [NEEDS VERIFICATION] (rehearsal item).
7. **Host-support questions** (no code): ask each of the seven named hosts' support the same four questions (outbound
   HTTPS from the game process? a second process or custom startup? an extra TCP port? a console to issue an API
   token?). The answers fill the "not stated" cells above and decide whether (b) or (c) is next.

### 3. Secret store on Linux: a 0600 file first; systemd-creds later and optional
- **Choice now:** the 0600 file. DPAPI's protection is against other users and offline copies, not against malware as the
  same user. A 0600 file in a 0700 directory owned by a dedicated service user gives the same protection against other
  users, works in a container volume and on every distro, and needs no root at setup.
- **Why not `systemd-creds` first:** its host key is `/var/lib/systemd/credential.secret`, root-only
  (`systemd-credentials-2026-10-25.md` E1), so the agent (unprivileged) cannot decrypt its own file. The pattern is
  `LoadCredentialEncrypted=` with systemd decrypting into `$CREDENTIALS_DIRECTORY` (E1, E2), which needs root to write
  the credential at setup and cannot hold the agent secret that the agent itself writes on enrolment and rotates on
  re-enrol. It also does not exist in containers, WSL or non-systemd distros. A root attacker on the same disk defeats both. The gain is
  protection of a stolen disk image or backup.
- **Cheapest step that keeps the option open:** the `SecretBox` seam in step 2. Trigger for `systemd-creds` (read-only
  game tokens via `LoadCredentialEncrypted=`): a user or a security review asks for encryption at rest on a shared box,
  or the agent secret moves out of the agent's own writes. Minimum systemd version and Debian 13 / Ubuntu LTS versions:
  [NEEDS VERIFICATION], checked in the rehearsal.

### 4. Rehearsal on the homelab VM, against staging only
Nothing in CI or the product may reference the VM; its host name and address never enter this repository; the rehearsal
log (raw-sources captures) is sanitized to versions, ports, timestamps and counts.
1. **Server**: SteamCMD as an unprivileged user (`linux-...` E1), the VM's CPU type set to pass-through, not `kvm64`
   (E1). Check the game build is >= 513885 for FRM 1.5.4 (E5).
2. **Mods**: SML 3.12.0 and FRM 1.5.4 `LinuxServer` targets with `ficsit-cli` (it can run on the server,
   `sml-dedicated-server-setup.md`). Capture FRM's real Linux `GameUserSettings.ini` keys and the web server's bind
   address into `raw-sources/` (closes the gap in `frm-config-port-1.5.4-2026-10-20.md`: ini syntax).
3. **Token**: try `server.GenerateAPIToken` at the Linux console, and record how (the Docker route too);
   `AllowInsecureLocalAccess=1` as the fallback.
4. **Agent**: build the tarball, run under the unit, enrol with a one-time staging code. Prove: snapshots arrive; `kill -9`
   and a VM reboot restart it; a cut network gives backoff, no crash, and the `agent_offline` alert fires (ADR-0031 §3);
   a loose-permission file is refused; no secret in the journal (the log redaction in `agent/CLAUDE.md:16-17`).
5. **Docker variant**: the same with the robtme image and the sidecar compose file.
6. **Reaching staging** needs the owner's choice (Question 4): the throwaway staging task is behind Cloudflare Access
   (ADR-0049 D3), so the agent would need to send the Access service-token headers and staging would need to stay up
   for the session. No production secret, no production hostname, on the VM.
7. **Afterwards**: revoke the staging credential in the dashboard, delete the VM's agent state, and record the dated
   findings as raw-source captures plus a log fragment.

### 5. Deferred
- **(c) Relay agent**: *not yet.* Trigger: a real player on a host that blocks processes and mods but exposes 7777 and
  can obtain a token. Cheapest step now: none; keep `isAllowedGameHost`. When built: an explicit opt-in to a remote host,
  certificate pinning (trust on first use, fingerprint stored with the secrets), TLS-only for the token, and FRM only if
  reachable (plain HTTP and tokenless, so never over the internet without the player's own tunnel or VPN).
- **(d) Backend pull**: *not recommended.* It is the only mode that makes the cloud hold game tokens and call into player
  networks. Trigger to reopen: a measured number of players who cannot run (a), (b) or (c), and an owner decision to
  accept the posture change with the SSRF controls above. Needs explicit owner approval; a security review first.
- **Managed-host partnerships** (asking a host to preinstall the mod or agent): not yet. Trigger: the mod is on
  ficsit.app and a host asks.
- **A Windows service installer, `.deb`/`.rpm`, Node single executable, auto-update**: not yet (ADR-0031 phase 2).
- **Sharding, replicas, queues**: not applicable; ingest volume does not change with the host type.

## Consequences
- Linux self-hosters and Docker users are covered without a protocol change, a UE toolchain or a posture change.
- The agent code gains one seam (the secret store) and two small packaging artefacts; the backend is untouched.
- Panel and FTP hosts are covered only through the mod or, later, a relay. Until the support questions are answered, the
  docs state "not supported" for a host that cannot run either.
- ADR-0042 sub-project 5 changes (no agent deprecation); the owner decides.
- The product's claims about hosting must cite `raw-sources/`; a host's "outbound allowed" stays [NEEDS VERIFICATION] until
  its support or a test answers.

## Revisit when
- A host's support states outbound HTTPS is blocked or allowed (decides (b) versus (c) for that host).
- The first player on a host with no shell and no mods (build the relay spike).
- Game or FRM changes the API port, token flow or Linux target.
- systemd-creds is asked for, or the agent secret stops being written by the agent.

## Questions for the owner (recommendation first)
1. **Keep the Node agent alongside the mod** (amend ADR-0042 sub-project 5: no deprecation; the agent is the path where
   the player controls a process)? *Recommend yes.*
2. **Order: Linux agent, then the Docker sidecar image, then the mod's Linux target (ADR-0042), then the support
   questions; relay and backend-pull deferred?** *Recommend yes.*
3. **Linux secret store: 0600 file first, systemd-creds opt-in later?** *Recommend yes.*
4. **How should the rehearsal reach staging?** Options: (A) a `workflow_dispatch` job that holds the staging task up for a
   few hours, plus the agent learning to send the Access service-token headers from the secret store (the token is a
   staging secret on a homelab device; revoke after). (B) run the backend from the compose file on the VM for the first
   smoke and use staging for the final check only. *Recommend A for the sign-off and B for the first smoke, if you allow
   a local backend on the VM; otherwise A only.* Either way an `infra/aws` change follows the apply-first rule.
5. **Send the four support questions to the hosts (Nodecraft, GameServerKings, LOW.MS, Game Host Bros, XGamingServer,
   Shockbyte, Supercraft)?** It costs nothing; you send them, since I cannot. *Recommend yes.*
6. **Package as a GHCR container image plus a tarball with a systemd unit; no `.deb`/single-binary until the first other
   player?** *Recommend yes.*
7. **Relay agent (c): defer until a player needs it?** *Recommend yes.*
8. **Backend pull (d): do not do it?** It reverses "the cloud never holds a game token and never reaches in". *Recommend no;
   it needs your explicit approval to ever reopen.*
9. **Add a "basic data" state for vanilla-only servers (check in step 1)?** *Recommend yes.*

## Build plan
| # | PR | Owner | Tier |
|---|---|---|---|
| 1 | This ADR and the three raw-sources captures (docs) | dev | skip |
| 2 | `agent/`: `SecretBox` seam + file store + `STATE_DIRECTORY` (steps 2-3) | dev | FULL + security |
| 3 | Vanilla-only fixture check (step 1) | backend + frontend | QUICK |
| 4 | systemd unit, runbook, Linux CI checks (step 4) | dev | QUICK + security |
| 5 | Container image + tarball release (steps 5-6) | dev | FULL (images job in `scripts/ci-select.mjs`) |
| 6 | Rehearsal on the VM: captures and a log fragment (docs) | owner + dev | runbook |
