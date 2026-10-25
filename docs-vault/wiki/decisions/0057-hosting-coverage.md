# ADR-0057: Hosting coverage: the dashboard on as many server hosting types as possible, Linux self-hosting first

Status: **accepted** (2026-10-25, after the owner answered the questions; amended the same day by this change: owner's
answers, Decisions 6 and 7, a revised build order). Written at the owner's
request (2026-10-25): "ideally my board just works with as many hosting types as possible so we need to research how to
do that". The owner also approved the same day: start with Linux self-hosters, write this ADR first, and rehearse on a
homelab Linux VM (Debian 13, 8 vCPU, 16 GB) with a Linux dedicated server, SML, FRM and a Linux agent paired with the
**staging** backend only: never production, no production secrets on homelab devices, nothing in CI or the product may
depend on the VM, and no host names or IPs in this repository. Nothing here is built until the owner answers.

Evidence is cited to `raw-sources/`; anything not captured is **[NEEDS VERIFICATION]**. New captures for this ADR:
`game-hosts-panels-2026-10-25.md` (hosts), `linux-server-docker-pterodactyl-2026-10-25.md` (Linux server, Docker image,
Pterodactyl egg, ficsit.app Linux targets), `systemd-credentials-2026-10-25.md` (secret store), and, for the amendment,
`mod-updates-restarts-device-auth-2026-10-25.md` (RFC 8628, mod update and restart behaviour, host restart schedules).
Short forms below: `linux-...` is the second file, `panels` is the first, `updates` is the last.

## Owner's answers (2026-10-25)

The owner's words, verbatim: "Not gonna ask their support desk. someone can report it if needed. Servermanager is also
just a tool to help me out, not necessary. if a server has our mod installed it should boot up when the server boots up.
Big thing is how to update the agent if the server is always required to be on. Allow the staging on the vm or whatever.
If the host does not allow outbound connections, thats on them or the user to figure out a workaround. yes on 3. Has to be
as easy as possible to set up our system. the ideal ideal is a person has a server, they install the mod, they go to our
page to setup if needed (codes or whatever, code given in game) and they see the dashboard thereafter. No to 8. Basic data
view is fine."

On the updates question, later the same day (the owner's own message in the dash session): "Mod updates for the agent should ever be force pushed,
isntead should be deliberate by the user. We can limit functionality of the dashboard if they dont update. This is in case
on of our updates to the agent is a major vulnerability like remote code execution". The architect reads "ever" as
"never": no update is ever pushed to a server; every update is a deliberate user action.

| Q | Answer | Recorded as |
|---|---|---|
| 3 | Yes | Linux secret store: a 0600 file first, `systemd-creds` opt-in later (Decision 3) |
| 4 | Both A and B allowed | A staging-only secret on the homelab VM is OK, never production. An `infra/aws` change still follows the apply-first rule: never auto-merge a PR touching `infra/aws/*.tf`; the owner applies Terraform from the branch first |
| 5 | No | No support-desk outreach; users report host limits; the "not stated" cells stay as they are |
| 7 | Relay not built | A host that blocks outbound connections is the host's or the user's problem; no relay agent |
| 8 | No | No backend pull; the cloud never holds a game token and never reaches in |
| 9 | Yes | A "basic data" view for vanilla-only servers (Decision 2 step 1) |
| 1, 2, 6 | Not answered directly | **The architect's reading** of the stated ideal, to be corrected by the owner if wrong: (1) the in-game mod is the PRIMARY path and the product's north star; the Node agent stays as the path where a player controls a process (Linux, Windows, Docker) until the mod covers that host, and is not deprecated at parity. (2) The order follows from that: the mod's pairing flow and the Linux agent first (Decision 8). (6) The recommended packaging (GHCR image plus a tarball with a systemd unit; no `.deb` or single binary until another player needs it) is **kept, but the owner did not answer it explicitly** |
| 10 | Server Manager | The Electron Server Manager (ADR-0040) is the owner's personal tool, not part of the product and not on the product's path. It is referred to here only by reference; ADR-0040 gets an "Amended by" line at most |

Consequences of the answers: Decision 2 step 7 (host-support questions) is dropped; Deferred item (c) becomes "not built",
(d) "no"; Question 5, 7 and 8 below are closed.

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

### 2. Linux agent build steps (smallest first; each is a separate PR, no stacking; the overall order is Decision 8)
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
   requires the repo's Node version. Not now: a `.deb`/`.rpm`, a Node single-executable build. Releases are signed
   and verified for user-initiated installs (Decision 7); the agent never updates itself.
6. **Docker sidecar**: a compose example where the agent shares the game container's network
   (`network_mode: "service:<game>"`), so the agent reaches the game at `127.0.0.1`, which `isAllowedGameHost` already
   allows. The alternative, a service name, would need a guard change and is not recommended. For the vanilla token in
   a container: `AllowInsecureLocalAccess=1` is documented for loopback (`dedicated-server-api.md` E5) and is safe only
   because the shared network namespace is not published; whether the image's `/config` lets the argument be passed is
   [NEEDS VERIFICATION] (rehearsal item).
7. ~~Host-support questions~~ **Dropped (owner, Q5):** no outreach to host support desks. The "not stated" cells stay
   as they are; a user whose host blocks outbound traffic or mods works around it or reports it.

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
6. **Reaching staging** (owner, Q4: both options allowed): (B) first smoke against the backend run from the compose file
   on the VM; (A) sign-off against the throwaway staging task behind Cloudflare Access (ADR-0049 D3), which needs the
   agent to send the Access service-token headers and staging to stay up for the session. A staging-only secret on the VM
   is accepted; never production, no production hostname. Any `infra/aws` change keeps the apply-first rule: such a PR is
   never auto-merged, and the owner applies Terraform from the branch first.
7. **Afterwards**: revoke the staging credential in the dashboard, delete the VM's agent state, and record the dated
   findings as raw-source captures plus a log fragment.

### 5. Deferred
- **(c) Relay agent**: *not built (owner, Q7: blocked outbound is the host's or the user's problem).* Old trigger, kept
  only as the condition for the owner to reopen it: a real player on a host that blocks processes and mods but exposes 7777 and
  can obtain a token. Cheapest step now: none; keep `isAllowedGameHost`. When built: an explicit opt-in to a remote host,
  certificate pinning (trust on first use, fingerprint stored with the secrets), TLS-only for the token, and FRM only if
  reachable (plain HTTP and tokenless, so never over the internet without the player's own tunnel or VPN).
- **(d) Backend pull**: *no (owner, Q8).* It is the only mode that makes the cloud hold game tokens and call into player
  networks. Trigger to reopen: a measured number of players who cannot run (a), (b) or (c), and an owner decision to
  accept the posture change with the SSRF controls above. Needs explicit owner approval; a security review first.
- **Managed-host partnerships** (asking a host to preinstall the mod or agent): not yet. Trigger: the mod is on
  ficsit.app and a host asks.
- **A Windows service installer, `.deb`/`.rpm`, Node single executable**: not yet. **Auto-update of the agent or the mod,
  in any form: never** (owner, Decision 7); this supersedes ADR-0031's "signed update check" phase-2 idea.
- **Sharding, replicas, queues**: not applicable; ingest volume does not change with the host type.

### 6. Zero-touch setup, the north star (amendment)
**Goal (owner):** a person has a server, installs the mod, goes to our page, enters a code the server gave them, and sees
the dashboard. Nothing else: no file edit on the server, no code made in advance, no second program.

**Already decided, not repeated.** ADR-0051 §1 designs the device-code pairing in full (`POST /agent/v1/pairings`, poll,
the signed-in `/pair` page, one use, 60-bit `XXXX-XXXX-XXXX` user code, 128-bit secret stored hashed, bounds table). It is
not built: no `pairings` route exists in `backend/src`, `packages/shared/src` or `frontend/src` (grep, 2026-10-25). This ADR
adds only what 0051 left open: where the code appears on each kind of host, what the mod must store, and what makes it
zero-touch. Reuse, not new machinery: enrolment's rate limiter and transaction (`agentApi.ts:95-141`), the `agentVersion`
field the contract already carries on enrol and every snapshot (`packages/shared/src/agent.ts:56,119`) and the backend's
stored "version last reported" (`agent.ts:211`).

**The flow (chosen).**
1. Install: SMM, ficsit.app or an SFTP upload puts the mod in `FactoryGame/Mods` (`sml-dedicated-server-setup.md`,
   `game-hosts-mods-2026-10-20.md`). SML loads mods at server start, so the mod starts with the server, with no second
   process (owner: "it should boot up when the server boots up").
2. First boot with no credential: the mod asks for a pairing and shows the code (surfaces below). It needs no config file
   (the current `SatisDashAgent.cfg` with an empty code is the fallback only; `mod-core-v1-config.md`).
3. The player opens our site (`/pair`), signs in, types the code, and sees the server's name and the mod version on a
   confirmation screen (RFC 8628's "confirm you possess the device", `updates` E6). Approval creates or re-pairs the server.
4. The mod's poll gets the credential, stores it, and the next push (5 s) shows data. The player lands on the dashboard.
   After that, restarts reuse the stored credential: no code, no visit.

**Where the code is shown (which surfaces exist).**

| Surface | Works on | Status |
|---|---|---|
| A log line in `FactoryGame.log` | every host that gives log access; the log is "under `<install dir>/FactoryGame/Saved/Logs` or potentially another location" (`sml-dedicated-servers-2026-09-27.adoc`) | **primary**, always written |
| The server's console output (stdout) | self-hosted, Docker (`docker logs`), and panel hosts whose console mirrors it: whether each panel mirrors it is not captured | **primary**, with the log line; the code is repeated every few minutes while unpaired so a late reader sees it |
| An in-game chat message or chat command to joined players | needs a spike: whether a server-only mod can message joined players is [NEEDS VERIFICATION] (ADR-0051 §1, `updates` NOT FOUND) | **later**, an optional extra |
| A file the mod writes (e.g. `pairing.txt` beside its state) | any host with SFTP or a file manager, which every mod host already has for the install | **fallback** for panels with no usable console; costs one file read, not an edit |
| The server's admin UI | no mod-reachable admin UI is captured | not planned |

A host that shows none of these cannot pair by this flow; the config-file code (today's path) still works there.

**What the mod stores, and where.** Only what pairing needs: the backend URL (default baked in), and after approval the
per-server credential, in the mod's own state file (`store.json` beside the mod; its exact directory is
[NEEDS VERIFICATION], since `mod-core-v1-config.md` names the file, not the path). The pending `pairingSecret` and user code
live in memory and in that state file only until the pairing ends. On a host with only SFTP the file is readable by whoever
has SFTP and by the host's staff; ADR-0045 is the threat model. The mod cannot use a DPAPI-like store inside the game; the
file is created with the narrowest mode the OS allows. Revocation (the owner deletes or re-pairs the server in the dashboard)
makes the next push return 401; the mod then clears the credential and starts a new pairing, so a restored backup cannot
resurrect a revoked server.

**Security (on top of ADR-0051's bounds table, which stands).**
- *Brute force:* 60-bit code, entry only by signed-in accounts, per-account and per-network limits, 15-minute expiry and
  one use (ADR-0051). RFC 8628 asks for exactly this (`updates` E3, E4: short user code rate-limited, long high-entropy
  device secret). Poll rate follows the RFC: a fixed `interval` and a `slow_down` answer that adds 5 s (E2); a client that
  polls faster is throttled.
- *Phishing and claim hijack:* an attacker who sees a code in a shared console can enter it first, or trick a player into
  entering the attacker's code. Controls: the confirmation screen names the server and mod version before anything is
  created (E5, E6); no `?code=` prefill link (kept out, as in ADR-0051); the mod logs the approving account's generated
  display name so the admin sees who paired; deleting or re-pairing revokes. The credential is bound at approval to the
  signed-in account that approved it, and to nothing on the game host: pairing proves "I can read this server's log or
  console", which is the same trust as today's file-edit step.
- *Public client:* the mod is a public client and holds no secret that outlives revocation (E7).
- *No second factor on the code:* accepted; the cost of a hijack is one server slot on the attacker's own account and it
  reads nothing of the victim's (ADR-0051).

**Options considered and rejected.** (1) A code the player generates on the site first and pastes into the server: it is
today's flow and needs a file edit. (2) Login from the game with the player's site credentials: puts a password in a
console and in a host's logs. (3) A QR code: no surface shows an image. **Cheapest keep-open step:** the contract and
backend from ADR-0051; the mod's pairing part is the mod session's.

### 7. Updates when the server must stay on: deliberate, never pushed (amendment)
**Owner's rule (quoted above):** no update is ever forced onto a server. Not for the Node agent, not for the mod. The
reason is blast radius: a vulnerable or compromised release (the owner's example: remote code execution) must not reach
every server by itself. So there is **no self-update, no backend-triggered update command, no silent download-and-swap,
no auto-update default.** The lever is the opposite one: the dashboard offers updates and limits what outdated versions
can do.

**What the user does, per component.**

| Component | How an update is applied | Needs a game restart? |
|---|---|---|
| Node agent | The user installs the new release on purpose: replace the tarball's files or pull the new image, then restart the **agent** service only (`systemctl restart`, `docker restart` of the sidecar, or the Scheduled Task). The agent is a separate process from the game (`agent/CLAUDE.md:5`), so the game server never goes down | **No** |
| Mod | The user updates it with SMM or ficsit.app, or by uploading the new files; mods are loaded when the server starts, hosts say to stop the server before changing mods and to restart after the SMM update (`updates` E8, E9). Whether a mod can be replaced in a running server is not documented; treated as **no**, [NEEDS VERIFICATION] on the rehearsal VM | **Yes**, at the user's next restart; hosts offer scheduled restarts (`updates` E11), so the update can wait for one |

"Server must stay on" therefore costs nothing for the agent, and for the mod it means the update waits for the next restart
the user already plans. We never ask for, schedule or trigger a restart.

**Dashboard behaviour (the lever).**
- The mod and agent report their version on every push (already so: `agent.ts:119`, stored at `agent.ts:211`). The dashboard
  shows "update available, applies at the next server restart" for the mod and "update available, restart the agent only" for
  the agent, with release notes and the install steps. It never installs anything.
- **Compatibility window.** The backend supports the current contract version and the previous minor releases of the mod and
  the agent: **N and N-1 fully (N-2 for the agent only if its release cadence is quick)**, counted in releases that changed
  behaviour, not patch numbers. Because the mod rarely changes (logic lives server-side; the mod only reads and pushes), most
  releases are compatible with several backend versions. The `/agent/v1` URL never changes; changes are additive
  (ADR-0007 expand, migrate, contract). A breaking change is a new `/agent/v2` served beside v1 for a stated deprecation
  period (one release of the product plus at least 90 days), announced in the dashboard before it applies.
- **Outdated means reduced, not broken.** A version older than the window keeps working for the basics the old contract
  carried (status, power, auto-pause) and loses the features that need newer data, each with a plain reason ("needs mod 1.4 or
  newer"). A version below the **minimum safe version** is refused for the features that expose risk and shown a
  banner; the backend never sends it code.
- **Security advisories.** A release with a security fix gets an advisory entry (id, affected range, fixed version, plain
  summary) published in the repo and as a server-side table (`min_safe_version`, `advisories`). The dashboard shows a banner to
  the owners of every server running an affected version, the notice names the fixed version and the install steps, and the
  backend raises `min_safe_version`. A version known to be vulnerable is refused (its pushes rejected with a stable
  code, or its commands not served), which limits the damage of a bad release without ever shipping anything to the game host.
  Raising the minimum is an owner action in the backend, not automatic; the banner comes first, enforcement after a stated
  grace period, shortened for an exploited issue.
- **Signing stays, for user-initiated installs.** Release artifacts (tarball, image digest) are signed in CI (keyless
  signing through the CI identity is the cheapest form: sigstore/cosign for the image, with the checksum file signed for the
  tarball: [NEEDS VERIFICATION] against current cosign docs when built) and the install runbook says how to verify. Key handling:
  no long-lived private key in the repo; the signer is the CI workflow's identity. The agent does not check signatures at
  runtime because it installs nothing. ficsit.app and SMM are the mod's channel, with their own review (`ficsit-app-mod-rules-2026-10-20.md`).
- **Not recommended and why:** an in-agent self-update (signed artifact, swap, health-check rollback) was the draft
  proposal; the owner rejected it because it is also the delivery path for a hostile release. Platform package managers or
  Watchtower-style auto-pulling containers are the same thing under another name and are off by default and undocumented
  as a recommendation; a user who turns them on does so on their own account.

### 8. Build order (revised)
1. **Contract and backend: pairing (ADR-0051 §1)** as its own contract PR first, then backend, then the `/pair` page; the
   vanilla-only "basic data" check (step 1 above) alongside. Version policy in the same contract PR: a `compat` block the
   dashboard reads (`current`, `minSupported`, `minSafe`, advisories), additive only.
2. **Mod pairing flow and compatibility policy** (mod session), alongside the Linux agent: log line and stdout code,
   the `pairing.txt` fallback, poll with `slow_down`, store the credential, clear it on 401. Mod reports its version.
3. **Linux agent**: Decision 2 steps 2-4 (`SecretBox`, `STATE_DIRECTORY`, systemd unit), then the tarball and GHCR image
   (steps 5-6). The agent uses the same pairing endpoint when it has no credential.
4. **Dashboard update surface:** "update available" per server, compatibility banner, advisory banner and
   `min_safe_version` enforcement (frontend + backend); documentation of the deliberate-update steps.
5. **Rehearsal on the homelab VM** against staging (Decision 4), including: pairing with a real mod, a mod update with a
   restart, an agent update with an agent-only restart, and whether a mod can be replaced in a running server.
6. Host-support questions: **dropped**. Relay and backend pull: **not built**.

## Consequences
- Linux self-hosters and Docker users are covered without a protocol change, a UE toolchain or a posture change.
- The agent code gains one seam (the secret store) and two small packaging artefacts; the backend is untouched.
- Panel and FTP hosts are covered only through the mod or, later, a relay. Until the support questions are answered, the
  docs state "not supported" for a host that cannot run either.
- ADR-0042 sub-project 5 changes (no agent deprecation at parity); ADR-0051 §1's pairing becomes the first build, not
  an option; ADR-0031's "signed update check" phase-2 idea is superseded by Decision 7 (no auto-update). ADR-0040
  (Server Manager) is untouched except an "Amended by" line saying it is the owner's personal tool.
- Outdated installs lose features instead of being updated; a vulnerable release is contained by the backend refusing
  it, never by pushing code to servers. The cost is that a user who ignores banners stays on an old version until they
  act; that is the owner's chosen trade.
- The product's claims about hosting must cite `raw-sources/`; a host's "outbound allowed" stays [NEEDS VERIFICATION] until
  its support or a test answers.

## Revisit when
- A test shows a mod can be replaced in a running server (the restart caveat in Decision 7 changes).
- A server-only mod is shown able to message joined players (add the in-game code surface).
- An advisory is ever needed in practice (rehearse the banner and refusal path once before relying on it).
- A user reports a host that blocks outbound traffic (the owner's call whether a relay is then worth it).
- Game or FRM changes the API port, token flow or Linux target.
- systemd-creds is asked for, or the agent secret stops being written by the agent.

## Questions for the owner (all nine original questions answered; see "Owner's answers")
Remaining, few, each with a recommendation:
1. **Confirm the reading of Q1, Q2 and Q6** (the mod is primary, the agent stays for hosts where the player controls a
   process, packaging as a GHCR image plus a tarball). *Recommend: confirm; no action if you say nothing.*
2. **Enforcement of `min_safe_version`:** the backend refuses a known-vulnerable version after a banner and a grace
   period (never pushing code). *Recommend yes: 14 days after the banner, 48 hours for an exploited issue, owner raises the
   minimum by hand.*
3. **Compatibility window:** N and N-1 for the mod, N-1 for the agent, a deprecation period of at least 90 days for a new
   `/agent/v2`. *Recommend yes; it is cheap to loosen later and costly to tighten.*
4. **Where the pairing code also appears:** log line and console now; a `pairing.txt` fallback; in-game chat only after a
   spike. *Recommend yes.*

## Build plan
| # | PR | Owner | Tier |
|---|---|---|---|
| 1 | This ADR (accepted) and the four raw-sources captures (docs) | dev | skip |
| 2 | Contract: pairing schemas (ADR-0051 §1) and a `compat` block (version policy), its own PR | dev | FULL + security |
| 3 | Backend pairing + `/pair` page; vanilla-only "basic data" view | dev (backend + frontend) | FULL + security |
| 4 | Mod: pairing flow (log/stdout code, `pairing.txt` fallback), reports its version | mod session | per the mod repo |
| 5 | `agent/`: `SecretBox` seam + file store + `STATE_DIRECTORY` (steps 2-3), then pairing in the agent | dev | FULL + security |
| 6 | systemd unit, runbook, Linux CI checks (step 4) | dev | QUICK + security |
| 7 | Container image + tarball release with signing (steps 5-6; Decision 7) | dev | FULL (images job in `scripts/ci-select.mjs`) |
| 8 | Dashboard update surface: update-available, compatibility and advisory banners, `min_safe_version` | dev | FULL |
| 9 | Rehearsal on the VM: captures and a log fragment (docs) | owner + dev | runbook |
