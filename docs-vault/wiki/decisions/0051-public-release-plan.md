# ADR-0051: Public release plan: device-code pairing, FRM, milestones, hosting after AWS, no email

Status: **accepted** (2026-10-24): the owner took every recommendation in "Questions for the owner" ("yes on 1",
answering the whole list). The legal items (FRM's licence, Coffee Stain's terms) are the owner's to clear; this ADR
records them as blockers and does not decide them.

Paths are under `backend/src/modules/` unless they start with a top-level directory. "The mod" is the companion
mod in `Sour-Dev-Home/satisfactory-dash-mod` (paths there are prefixed `mod:`).

## Context

**What exists today (2026-10-24):**

| Fact | Evidence |
|---|---|
| Self-serve servers, caps C1-C8 and the kill switches are built and shipped dark; sign-up is closed (`not_invited`), staging runs with both switches off | ADR-0046; #523-#530 closed; `identity/googleSignIn.ts:32-41`; `infra/aws/staging.tf:39-40` |
| The other gates of the mod's release are closed: #514, #515, #516 (abuse response), #311 (account deletion), #530 (privacy page, terms) | GitHub issues; `frontend/public/privacy.html`, `frontend/public/terms.html` |
| Gate B is open: the Google app is not published | #186 |
| Enrolment: the owner creates a code in the dash (10 minutes, single use, 60 bits `XXXX-XXXX-XXXX`) and pastes it into the game host's config | `packages/shared/src/agent.ts:187`; `agents/config.ts:11,23` (10/min per network, 1,200/min global) |
| The mod reads `FactoryGame/Configs/SatisDashAgent.cfg` and re-reads it when it changes, so a pasted code needs no restart | `mod:mod/SatisDashAgent/Source/SatisDashCore/Private/Agent.cpp:51-81` |
| The mod is 0.1.0, experimental, server-only, and declares only SML as a dependency | `mod:mod/SatisDashAgent/SatisDashAgent.uplugin:4-5,17,19,23,25-27` |
| The mod reads status, power and auto-pause natively; it has no FRM bridge yet (sub-project 3), so factory, map, belts and the planner need the Node agent and FRM today | `mod:docs/specs/2026-10-20-core-mod-v1-design.md:20-21,32`; `mod:mod/SatisDashAgent/Source/SatisDashGame/Private/GameReader.cpp:50` (the only FRM mention) |
| Belt-level detail needs FRM 1.5.4 or newer; older FRM gets item-level results with an "update FRM" note | `telemetry/services/bottleneckFinder.ts:728`; `telemetry/services/productionGraph.ts:205`; ADR-0048 amendment |
| FRM's web server does not start by default: `uWS.Autostart` must be set in `GameUserSettings.ini` and the server restarted | `docs-vault/wiki/frm-api.md:106-113` |
| FRM has no licence file or statement (GitHub reports none, again on 2026-10-24) | `docs-vault/raw-sources/frm-license-status-2026-09-27.md` |
| No Coffee Stain EULA or modding policy for Satisfactory was found at any reachable URL; ficsit.app's rules require a "Network Activity Transparency" and an "AI Usage Transparency" section and forbid paywalled features | `docs-vault/raw-sources/coffee-stain-mod-terms-2026-10-20.md`; `docs-vault/raw-sources/ficsit-app-mod-rules-2026-10-20.md` |
| Alarms (#501, #560), circuit-breaker rollback and a one-click rollback exist | `docs-vault/wiki/runbooks/aws.md` "Alarms"; `infra/aws/ecs.tf:122-133`; `.github/workflows/deploy.yml:7,21` |
| Every deploy stops the old task first (about a minute of downtime); #600 is deferred by the owner | `infra/aws/ecs.tf:119-120`; #600 |
| No email is sent, and accounts created by sign-up keep no email address | `frontend/public/privacy.html:49-50,164`; no mail library in the backend |
| AWS: Free plan, $139.89 of credits on 2026-10-15, plan ends 2027-03-15; about $33 a month; the exit starts at about $35 left or 45 days before the end | ADR-0034 §2, §4; #217 |
| The exit rehearsal is due by 2026-12-31 | #506 |

**Why now.** All of ADR-0046's gates except #186 are closed, so the remaining questions are the player's setup, the
legal blockers, the order of the last steps, and where the service runs once AWS ends, about three months away.

## Decision

### 1. Device-code pairing as the primary setup path

The mod (or the Node agent) asks the backend for a pairing, prints a short code, and waits; the player types the code
into the dash. This is the OAuth device authorization pattern (RFC 8628), reusing what enrolment already does.

**Why.** Today a player on a rented host must edit a file on the server (the host's file manager or SFTP) to paste a
code. That is the step most likely to stop someone. With pairing, the code goes the other way: the server prints it
in its console, which every host panel shows, and the player types it in a browser.

**Flow, from SMM to data on screen:**

| Step | Today | With pairing |
|---|---|---|
| 0 | Ask the operator for an invite (closed sign-up) | (gone once sign-up opens) |
| 1 | SMM: add the server (SFTP), install the mod | Same |
| 2 | Start or restart the server | Same |
| 3 | Sign in to the dash | Open the host console; copy the line `Pairing code ABCD-EFGH-JKLM: enter it at satis-manager.com/pair` |
| 4 | "Add your server", name it | Sign in at `/pair` (a new account accepts the terms) and enter the code |
| 5 | Generate a code in the agent settings | Confirm the server name shown; the server is created and paired. Data arrives on the next push (5 s) |
| 6 | Open the host's file manager, edit `SatisDashAgent.cfg`, paste, save | |
| 7 | Wait for data | |
| | **6 actions + an invite, one of them a file edit on the server** | **5 actions, no invite, no file edit** |

FRM layers add steps on both paths (section 2).

**How it works (a sketch for the build; the contract PR fixes the exact shapes):**
1. `POST /agent/v1/pairings` (unauthenticated, like enrol): body `{ agentVersion, serverName? }` (the session name,
   clamped like other strings). Returns 201 `{ pairingSecret, userCode, expiresIn: 900, interval: 5 }`.
   `pairingSecret` is 128 random bits, stored only as a hash. `userCode` keeps today's 60-bit `XXXX-XXXX-XXXX`
   format, so the code regex, the mod's validator and ADR-0046's guessing math all stay as they are.
2. `POST /agent/v1/pairings/poll` with `{ pairingSecret }` in the body (never in the URL, so it can't land in a log
   line). It answers pending, expired, or, once approved, runs the existing enrolment transaction and returns
   exactly enrol's 201 `{ agentSecret, serverId, cadence }`. The credential is minted at that moment, so no secret
   is ever stored in a readable form.
3. In the dash, `/pair` (signed in): the player enters the code, the page shows the server name, agent version and
   when it asked, and the player picks **new server** (the ADR-0046 create transaction, caps C1-C5 apply) or **one
   of my servers** (owner only; replaces its credential, like enrolling again). One use; the row is consumed.
4. The mod pairs only when it has no credential and the config holds no code. It prints a fresh code when the last
   one expires, for up to one hour, then stops and logs how to get a new one (restart the server). After pairing
   it logs the approving account's display name (generated, such as "Player-4F2K"), so a server admin can spot a
   hijacked code.
5. The config-file code stays as the fallback path (the Node agent and existing installs use it). No breaking change.

**Bounds and abuse.**

| Risk | Control |
|---|---|
| Someone floods pairing requests | 6 an hour per network, 600 an hour process-wide; rows swept an hour after expiry (the sweeper pattern in `agents/services/commandSweeper.ts`) |
| Someone guesses an open code | Codes are entered by signed-in accounts only: 10 a minute and 20 an hour per account (like C7), and new accounts are capped at 20 an hour (C8). At most about 150 codes are open (600/h x 15 min). A year of guessing at those limits is about 400 x 8,760 x 150 / 2^60, under 1e-9 |
| A code is seen in a host console by someone else, who enters it first | The same exposure as today's code in a config file. The admin sees the approving name in the log; the real owner's `/pair` says "already used"; deleting the server or re-pairing revokes it |
| A player is tricked into entering an attacker's code | The attacker's server lands on the victim's account and uses one C1 slot; it reads nothing of the victim's. The confirmation screen shows the server's name before anything is created |

Pairing rows hold the session name and agent version for at most about 75 minutes. The privacy page gains one row.

**Where it lives.** `packages/shared/src/agent.ts` (contract, its own PR first), `agents/` (routes, a pairing
service on top of `enrollmentService`, an expand-only migration), `frontend/src/selfServe/` (the `/pair` page,
next to `AddServer.tsx`). All three are the satisfactory-dash developer session's. The mod's pairing part is the mod
session's, in `mod:mod/SatisDashAgent/Source/SatisDashCore/`.

**Not now:** a code prefilled by URL (`/pair?code=...`, RFC 8628's `verification_uri_complete`). It makes phishing
easier and puts the code in browser history and edge logs. Revisit if players ask for it. An in-game chat message
with the code is also deferred: the console line works on every host, and a chat message needs a spike
[NEEDS VERIFICATION: whether a server-only mod can message joined players].

### 2. FRM as a dependency of the mod: blocked on the owner's legal clearance

What the `.uplugin` route would do, according to the SML docs: an entry in `Plugins` with the mod reference and a
`SemVersion` range tells SMM to download that mod with ours; `Optional: true` marks it not required; SMM never
picks a pre-release version of a dependency. [NEEDS VERIFICATION: capture
`docs.ficsit.app/satisfactory-modding/latest/Development/BeginnersGuide/ReleaseMod.html` into `raw-sources/` before
building on it, and whether SMM installs optional dependencies.] ficsit.app lists FRM 1.5.4 as its latest release
(2026-10-14) [NEEDS VERIFICATION: capture].

**Blockers (the owner's to clear, not decided here):**
- **FRM's licence.** FRM states none (`frm-license-status-2026-09-27.md`). Declaring it as a dependency doesn't copy
  its code (SMM downloads it from ficsit.app), but whether it's allowed, and whether the FRM bridge may call FRM
  in-process, is a legal reading only the owner (or FRM's maintainer, in writing) can settle.
- **Coffee Stain's terms.** Not found anywhere reachable (`coffee-stain-mod-terms-2026-10-20.md`). This blocks the
  mod's distribution on ficsit.app as a whole, not just FRM.

**Engineering facts that shape the answer once cleared:**
- The mod reads nothing from FRM today. A dependency adds value only in the release that ships the FRM bridge
  (sub-project 3). Declaring it earlier would put a web server mod on every player's host for nothing.
- A dependency doesn't remove FRM's own setup step: its web server is off until `uWS.Autostart` is set and the
  server restarts (`frm-api.md:106-113`). The bridge's design must say how that step is handled (documented step,
  or a way to read FRM that doesn't need its web server) [NEEDS VERIFICATION in sub-project 3].
- When it is declared, the range is `^1.5.4` (belt data). The dash already degrades gracefully below that.

**Recommendation:** no FRM dependency now. Once the owner clears the licence, declare FRM as a **required**
`^1.5.4` dependency in the same mod release as the FRM bridge, and not before.

### 3. Beta to public: milestones, in order

Each needs the one before it. Done items are listed so the order is checkable.

| # | Milestone | State | Proof |
|---|---|---|---|
| 0 | Privacy, terms, caps, kill switches, abuse tooling, account deletion, alarms, rollback, off-AWS backups | done | Context table |
| 1 | **Legal clearance** (owner): FRM licence or written permission; Coffee Stain's terms or the owner's written risk acceptance; ficsit.app's two transparency sections drafted | open | A dated owner note in `LEGAL.md` |
| 2 | **Device-code pairing** (section 1), shipped dark behind `SELF_SERVE_ENABLED` | new | Contract, backend, `/pair` page, mod part; e2e of pair-to-first-snapshot against staging |
| 3 | **Exit rehearsal on the target host** (#506, due 2026-12-31), done on the host chosen in section 4 rather than the PC | open | Restore from B2 on the new host, an agent posting to it, readiness green |
| 4 | **Load check**: one k6 run of ADR-0037's target scenario on staging (same task size as production) with 33 agents (C2 25 + 8 local) at production cadence plus browser readers | open (#449 is local-only today) | Report committed under `wiki/perf/`; CPU under 50%, no 5xx, p95 recorded as the baseline |
| 5 | **Move off AWS** (ADR-0034 §6), with the replacement alarms and deploy path of section 4 | open | Two quiet days on the new host; the privacy page names the new host |
| 6 | **Gate B**: the owner publishes the Google app (#186) | open, owner | Sign-in works for an account that isn't a test user |
| 7 | **Mod release** on ficsit.app (sub-project 4: Windows and Linux builds, host guide); FRM dependency only if milestone 1 cleared it and the bridge ships with it | open | SMM installs it on a rented test host; steps 1-5 of section 1's table pass |
| 8 | **Open**: `SIGNUP_MODE=open`, `SELF_SERVE_ENABLED=true` in production, C2 at 25 (a capped public beta) | owner go | `signup_busy` and C2 refusals watched for a week before raising C2 |

**Not gates (with their trigger):**
- **#600, deploy downtime:** the UI already shows last-known data during the minute (#600's own text). Revisit when
  more than about 50 servers are enrolled, or when a deploy-time gap shows in uptime reports.
- **Sign-up CAPTCHA (Cloudflare Turnstile):** C8 already bounds new accounts. Revisit when `signup_busy` refusals or
  the `auth-failures` alarm show a sign-up flood.
- **#568, re-accepting changed terms:** only needed before the first material terms change.
- **#561, supply-chain hardening:** recommended before milestone 8 (cheap on a public repository), not blocking.

### 4. Hosting after the AWS Free plan

The exit starts at about $35 of credits left or on 2027-01-29, whichever is first; at about $33 a month that is
around the third week of January 2027 (an estimate; the monthly credit check decides). The Paid plan is ruled out by
the owner.

| Option | Cost a month | For | Against |
|---|---|---|---|
| **A. Oracle Cloud Always Free, Ampere A1** (ADR-0034's named target), the repo's `compose.yaml` | $0 | Already designed and CI-booted; arm64 image fits; 2 OCPUs, 12 GB, 200 GB block storage (Oracle's Always Free page, re-checked 2026-10-24) | Idle reclamation (7 days with CPU p95, network and memory all under 20%); free A1 capacity in the home region can be unavailable at sign-up [NEEDS VERIFICATION when creating the instance]; self-run PostgreSQL (backups to B2 already exist) |
| **B. Hetzner CAX11** (2 Arm vCPUs, 4 GB) | about EUR 6 after the 2026 price rises [NEEDS VERIFICATION at order time] | Predictable, no reclamation | Paid; a new processor on the privacy page |
| C. The game PC | $0 | Known | Public users depend on the owner's home PC and connection; mixes the game server with a public service |
| D. Managed free tiers (a free Postgres plus a free app host) | $0 | Managed database | Free app hosts sleep or cap usage, and the backend runs workers that must stay up; more processors; more vendor lock-in |
| E. Stay on AWS | ruled out | | Paid plan declined; a second Free account to get new credits is rejected outright |

**Recommendation: A, with B as the named paid fallback, and C only as an emergency.** Create the Oracle tenancy and
the instance during the rehearsal (milestone 3), so a capacity problem shows up in December, not in the exit
window. Size it so memory stays over 20% (ADR-0034 §5). If no A1 capacity is available by 2027-01-05, switch to B.

**What the move must replace (designed in the exit ADR, written at exit time per ADR-0034 §3):**
- **Deploys:** ADR-0049's ECS pipeline ends. Recommended: the host pulls a released image digest on a timer (no
  inbound SSH, no cloud credentials in GitHub). Staging becomes a second compose project with its own tunnel, started
  only during a deploy.
- **Alarms:** CloudWatch goes away. Minimum: the external uptime monitor on `/api/health/ready` (ADR-0028), and
  fatal or `WORKER_FAILING` lines sent to an ops Discord channel.
- **Privacy page:** the hosting row changes in the move PR (ADR-0034 §7).

**Launch after the move.** Milestone 8 comes after milestone 5, so public users never go through a host migration
and the processor list doesn't change right after launch.

### 5. Confirmation emails: none

No email is sent and sign-up keeps no address (`privacy.html:49-50,164`). That stays. Sign-in is Google's, so there
is no password reset or address check to send; alerts go to Discord and web push (ADR-0027, ADR-0044); a terms change
is accepted in the app (#568); account deletion is self-service (ADR-0047).

Revisit when a feature has to reach a user outside the app (emailed alerts asked for by players, or a legal notice
the app can't deliver). Then: opt-in only, a separate deletable column, a provider outside AWS, and its own row on
the privacy page.

## Consequences

- First-time setup drops from six actions plus an invite to five, with no invite and no file editing on the game
  host (the step most likely to stop a player on a rented host).
- One new unauthenticated agent endpoint pair, bounded by rate limits and a sweep; the existing enrol path and its
  contract are unchanged.
- The public launch moves to after the AWS exit, around February 2027, and depends on two legal answers only the
  owner can give.
- The mod stays FRM-free until the bridge ships, so its first public release shows status, power and auto-pause
  only, unless the bridge lands first.
- One more deployment to keep working (the Oracle compose host) replaces ECS; the AWS work stays as portfolio
  evidence in `infra/aws/` and the ADRs.

## Build tasks (after approval)

1. Contract: pairing schemas and endpoints in `packages/shared/src/agent.ts` (own PR). Developer session.
2. Backend: migration, pairing service and routes, limiters, sweep; tests for every row of the bounds table.
3. Frontend: `/pair` page with the confirmation step; e2e from pairing to first snapshot.
4. Mod: the pairing part, after task 1 is on `main` (mod session; the mod vendors the contract).
5. Privacy page row and host guide text.
6. Milestones 3 to 5 (rehearsal, load check, move): separate issues, with the exit ADR at milestone 5.

## Revisit when

- FRM's maintainer states a licence, or Coffee Stain publishes terms.
- Oracle A1 capacity is unavailable by 2027-01-05 (switch to option B).
- C2 refusals in the capped beta show demand above 25 servers (re-derive C2 from #515's bound and the load report).

## Questions for the owner

Answered 2026-10-24: all nine as recommended. Items 2 and 4 are the owner's to send (the FRM maintainer, Coffee
Stain); milestone 1 stays open until their answers are dated in `LEGAL.md`.

**Changed 2026-10-24 (owner):** questions 2 and 4 are answered "don't ask": "not gonna ask, not expected within the
community". The owner accepts the risk in writing (dated in `LEGAL.md`), so milestone 1 rests on that acceptance and
the ficsit.app transparency sections, not on answers from FRM's maintainer or Coffee Stain. A `.uplugin` dependency
names FRM for SMM to install; it does not bundle or redistribute FRM's code.

1. **Pairing:** adopt device-code pairing as the main path, with the config-file code kept as the fallback?
   Recommended: yes.
2. **FRM licence (legal, yours):** ask FRM's maintainer for a licence statement or written permission to declare FRM
   as a dependency and to read it from the bridge? Recommended: yes, ask now; until there is an answer, no dependency.
3. **FRM dependency form, once cleared:** required `^1.5.4`, optional, or none (docs tell players to install it)?
   Recommended: required `^1.5.4`, in the same release as the FRM bridge.
4. **Coffee Stain's terms (legal, yours):** written confirmation from Coffee Stain, or ship under ficsit.app's rules on
   your own documented risk acceptance? Recommended: ask Coffee Stain first; decide by the time the mod is otherwise
   ready to release.
5. **Launch order:** open sign-up only after the move off AWS (about February 2027)? Recommended: yes.
6. **Hosting:** Oracle Cloud Always Free (A) with Hetzner CAX11 (about EUR 6 a month) as the fallback if A1 capacity
   isn't there by 2027-01-05? Recommended: yes, and create the Oracle instance during the December rehearsal.
7. **Load check:** allow one k6 run against AWS staging (not production), despite #449's local-only rule?
   Recommended: yes, once, before the move.
8. **Email:** keep "no email sent or stored"? Recommended: yes.
9. **#600:** confirm it is not a launch gate? Recommended: not a gate.
