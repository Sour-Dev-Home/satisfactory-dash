# ADR-0045: Threat model for game servers the owner doesn't control

Status: accepted (the owner merged #519 on 2026-10-20, which accepts every ACCEPT below; their answers to the open
questions are Amendment 1). Issue #505.

## Context
- ADR-0042 ships the mod to other players through ficsit.app. Its credential and its snapshots then come from hosts
  the owner doesn't control, running a build that may be modified. ADR-0031's ingest assumed "the agent is the
  server's own" (`backend/src/modules/telemetry/services/agentIngest.ts:17`).
- The mod is another agent on `/agent/v1` (ADR-0042 Decision), so the backend side of this model is the agent API as
  built. Mod-side behaviour is cited from `mod-claims.md` (spike evidence) or marked [NEEDS VERIFICATION]; the mod's
  own spec (`docs/specs/2026-10-20-core-mod-v1-design.md` in `satisfactory-dash-mod` at `14fae53`) was not re-read
  here.
- **What a stranger can do today.** Nothing without the operator: sign-up is closed
  (`identity/googleSignIn.ts:78-80`, ADR-0025 decision 4 A), only the operator creates servers
  (`servers/serverManagementRouter.ts:111`), a new server must first be a `local` one the backend can reach
  (`servers/serverManagement.ts:316-326`), and there are at most 8 (`servers/importServers.ts:10`). A third-party mod
  enrols only with a code an owner or admin of an existing server created.
- Paths below are under `backend/src/modules/` unless they start with a top-level directory.

## Decision
Every risk gets one disposition: **EXISTING** (a control read in the code, cited), **NEW** (a filed task), or
**ACCEPT** (with the reason and what would reopen it). L/I = likelihood / impact (L, M, H) for a public mod release
with sign-up still closed.

The new tasks: #514 (per-credential ingest budgets), #515 (per-server quotas), #516 (operator abuse response) and #517
(design for self-serve agent servers, parked until the owner opens sign-up). #514 to #516 are needed before the mod's
first public release; #517 before any stranger can get a server.

### 1. Mod to backend (enrolment, credentials, snapshots)

| # | Risk | L/I | Disposition |
|---|---|---|---|
| M1 | Guessing an open enrolment code | L/H | EXISTING. 40 random bits (`agents/services/enrollmentCode.ts:9`), valid 10 min and once (`agents/config.ts:7`, one guarded UPDATE in `agents/services/enrollmentService.ts:43-47`), one open code per server (`agents/services/agentsService.ts:72`), 10 tries a minute per network (an IPv6 /64 is one) and 120 a minute for the process (`agents/routes/agentApi.ts:75-89`). At the global cap all year, with 8 codes open all the time: about 6.3e7 guesses x 8 / 2^40, or 5e-4 a year. Every failure is the same `enrollment_code_invalid`. |
| M2 | Locking out honest enrolment by burning the global enrolment limit | M/L | ACCEPT now: codes are rare, operator-issued, valid 10 min, and a 429 is retried after a minute. Reopens with self-serve servers: #517 decides the code length and the global limit. |
| M3 | Mass enrolment (many servers, many credentials) | L/M | EXISTING while sign-up is closed: codes are minted only by an owner or admin of an existing server (`agents/routes/agentUser.ts`, membership check first), at most 10 a minute per user (`agents/services/agentsService.ts:61`), and servers are operator-created and capped at 8. NEW for self-serve: #517 (the cap counts `local` connections only, so agent-only servers would have none). |
| M4 | The code leaks from the host's config file | M/L | EXISTING: single use, 10 min, stored only as a SHA-256 (`agents/services/enrollmentService.ts:43`), never logged or audited (`agents/routes/agentUser.ts` header comment). The mod blanks the code after enrolling (ADR-0042 Context) [NEEDS VERIFICATION: the mod's behaviour, against its spec]. |
| M5 | The credential is stolen from a rented host (`Saved/SatisDash/credential.json`, readable by the host's panel or co-admins) | M/M | ACCEPT: it is 256 bits (`agents/services/enrollmentCode.ts:16`), bound to one server, only writes that server's data, and the owner revokes it (`agents/routes/agentUser.ts:45`) or re-enrolling replaces it. Who on a host can read the file is [NEEDS VERIFICATION] (`mod-claims.md` C6: "whether a game client can read it was not tested"). Reopens if a host exposes `Saved/` to other tenants or a theft is reported: then rotation or expiry. |
| M6 | Guessing a credential | L/H | EXISTING: 256 bits, looked up by hash, 600 a minute per network and 6000 for the process (`agents/services/agentAuth.ts:139-146`); unknown, revoked and removed are the same 401. |
| M7 | A valid credential writes another server's data or reads its commands | L/H | EXISTING: the credential names one server, and only an `agent` server that isn't deleted (`agents/repositories/agentRepository.ts:111-116`); every route uses `res.locals.agent` (`agents/routes/agentApi.ts:99-165`, `map/routes/agentWorldRoutes.ts`); another server's command id is a 404 (`agentApi.ts:151-152`). |
| M8 | A modified mod forges readings for its own server | M/M | ACCEPT: the backend can't verify game state, and a forged reading reaches only that server's members, history and alerts. Derived fields (`status`, `state`, counts, `unit`) are recomputed, unknown keys dropped (`packages/shared/src/agent.ts:66-71`), and `observedAt` is used only within 60 s of arrival (`telemetry/services/agentIngest.ts:33,77`). What forging can do to other servers is M10 to M12. |
| M9 | Oversized payloads, compression bombs, over-long strings | M/M | EXISTING: decompressed caps of 5 MB per snapshot (`agents/config.ts:10`, `agentApi.ts:110`), 2 MB per world layer (`packages/shared/src/map.ts:44`), 4 kB for enrol and result (`agentApi.ts:84,158`); schema bounds of 200-character strings and capped arrays, refused never clamped (`packages/shared/src/agent.ts:73-86`); world layers truncated at 5,000 items (`map/services/worldIngestService.ts:43-44`), live trains and stations at 2,000 (`map/services/mapLiveStore.ts:34-35`). |
| M10 | One credential burns CPU (5 snapshots a second of up to 5 MB each, all parsed) or holds many long-polls | M/H | NEW: #514 (rate from the cadence, a byte budget, one long-poll per credential). |
| M11 | One server fills the database (up to 1,000 circuits every 2.5 s; item rows per made-up class name, not checked against the catalog) | M/H | NEW: #515. Today's bounds: one recording per cadence (`telemetry/services/agentIngest.ts`, `powerDue`), 500 transitions per poll (`telemetry/services/factoryHistoryPoller.ts:37`), 20,000 rows per kind per flush (`telemetry/services/historyRecorder.ts:39,92-97`), retention 48 h / 30 d / 1 y (`telemetry/repositories/historyRepository.ts:16-19`). Detection: the `rds-free-storage-low` alarm (`runbooks/aws.md:215`). |
| M12 | One server floods the alert outbox (one subject per circuit, 50 rules), delaying everyone's alerts | M/M | NEW: #515 (subject and event caps, a per-server fair claim). Today: the claim is global oldest-first, 10 a tick (`alerts/repositories/deliveryRepository.ts:98-107`). |
| M13 | A compromised backend sends commands to every enrolled host | L/M | EXISTING for the contract: one command type, an unknown type is reported `unsupported` (`packages/shared/src/agent.ts:155-156`). The mod's own check is [NEEDS VERIFICATION] against its spec. |
| M14 | Payloads or player names in logs | L/M | EXISTING: no body is logged (`agentApi.ts:69-70`); `authorization` and `players` are redacted (`backend/src/platform/logger.ts:12-25`). |

**Limits per account and per credential, today:**

| Limit | Per credential (server) | Per account | Gap |
|---|---|---|---|
| Request rate | 50 snapshots or polls / 10 s; 20 world layers / 10 min (`map/routes/agentWorldRoutes.ts`) | 10 codes / min | #514 |
| Bytes | 5 MB a snapshot, 2 MB a layer, no budget per minute | none | #514 |
| Storage and history | one row set per cadence, retention as above, no per-server row cap | servers: operator-created, 8 | #515; #517 for accounts |
| Alerts | 50 rules a server; 5 test sends a minute per user (`alerts/services/alertsService.ts:78,193`) | 10 push devices (`alerts/services/pushService.ts:103`) | #515 |

### 2. Tunnel and edge

| # | Risk | L/I | Disposition |
|---|---|---|---|
| E1 | Reaching the backend around the tunnel | L/H | EXISTING: it listens on `127.0.0.1` unless `HOST` is set (`backend/src/server.ts:78`); on AWS the task's security group has no inbound rule (`infra/aws/network.tf:60-66`) and `cloudflared` reaches it over loopback (`infra/aws/ecs.tf:88-90`). |
| E2 | A spoofed client address dodges the rate limits | L/M | EXISTING: `CF-Connecting-IP` is trusted only from a loopback peer (`backend/src/platform/clientIp.ts:20-30`); an IPv6 /64 is one key (`agents/services/clientKey.ts`). |
| E3 | An unauthenticated flood uses up the process-wide agent-auth budget, so every valid agent gets 429 (data gaps, `agent_offline` alerts) | M/H | NEW: #514 (the global budget counts failures only). |
| E4 | Network-level floods on `/agent` | L/M | ACCEPT: Cloudflare absorbs them, and the app's limits are the real ones; the Free plan's one rate-limiting rule guards login (`runbooks/go-live-api.md` section 5, step 0). Reopens when the #514 counters show sustained refusals from many addresses. |
| E5 | The connection from a host to the edge is intercepted | L/H | EXISTING: the mod verifies certificates (`mod-claims.md` C3, spike S1b: a wrong hostname was refused). |
| E6 | The tunnel token leaks | L/H | EXISTING on AWS: it comes from SSM (`infra/aws/ecs.tf:91`). On the game PC it sits with the `cloudflared` service: see O1. |

### 3. Browser to backend (including sign-up and account lifecycle)

| # | Risk | L/I | Disposition |
|---|---|---|---|
| B1 | Stored XSS from strings a mod sends (names, class names, session name, `agentVersion`) | M/H | EXISTING: React escapes text; the one Leaflet tooltip is built from text nodes (`frontend/src/map/buildingsLayer.tsx:32-45`); the site's CSP allows only its own scripts (`frontend/public/_headers:6`); API responses carry `default-src 'none'` (`backend/src/platform/httpPolicy.ts:76`). |
| B2 | Reading another server's data | L/H | EXISTING: a non-member gets the same 404 as an unknown server, a viewer's write a 403 (`servers/serverAccess.ts:73-91`). |
| B3 | Cross-site requests and CSRF | L/H | EXISTING: CORS allowlist, cross-site guard and JSON-only bodies on `/api` (`backend/src/app.ts:66-68`). |
| B4 | A viewer mints an enrolment code and takes over the server's agent | L/H | EXISTING: codes and revoke are owner or admin only, and `local` servers need the operator (`agents/services/agentsService.ts:71`). An admin re-enrolling is within the owner's trust: ACCEPT. |
| B5 | A stranger signs up | L/H | EXISTING: closed sign-up (`identity/googleSignIn.ts:78-80`). Opening it waits for #517 and #186. |
| B6 | A live server left without an owner | L/M | EXISTING: a deferred constraint trigger (`backend/migrations/1791244800000_members_never_ownerless.sql`, #311 1/3). The deletion and leave flows are #311. |
| B7 | A deleted account's data stays | M/M | #311 (account deletion); push subscriptions cascade with the user (ADR-0044 Consequences). |
| B8 | An abusive account can't be shut off | M/M | NEW: #516 (nothing sets the `disabled` status that sign-in already refuses, `identity/googleSignIn.ts:82-84`). |
| B9 | Alert channels used as a relay (SSRF, or spam into someone's Discord) | M/M | EXISTING for SSRF: exact Discord hosts and path (`alerts/services/discordWebhook.ts`), a push-host allowlist checked on save and send (`alerts/services/pushEndpoint.ts`, ADR-0044 decision 3), redirects never followed (`alerts/services/discordSender.ts:5`). Message text from a mod is made inert and can't mention anyone (`alerts/services/alertMessage.ts:58-75`, `allowed_mentions` empty). Volume: #515. |
| B10 | A removed member still gets push | L/L | EXISTING by design: recipients resolved at write and rechecked at send (ADR-0044 decision 5); the send-time check is built in #348 (348-2), which must also keep mod-supplied text escaped. |

### 4. Operator tooling

| # | Risk | L/I | Disposition |
|---|---|---|---|
| O1 | The operator's PC or shell is compromised | L/H | ACCEPT: one operator; shell access is the trust boundary (`backend/scripts/admin.ts:1-2`, ADR-0025). AWS secrets are in SSM (`infra/aws/ecs.tf:91`; the rest is #206). |
| O2 | The admin CLI leaks a secret | L/H | EXISTING: output never includes secrets; the webhook is read from stdin (`backend/scripts/admin.ts:1-16`). |
| O3 | No way to cut off an abusive server | M/M | EXISTING: the operator's remove (`servers/serverManagementRouter.ts:146`) soft-deletes the server, and with it its credential, codes, history and alerts (`servers/repositories/serverRepository.ts:156-177`). |
| O4 | No signal for which server misbehaves | M/M | NEW: #514 (refusal counters per server; request metrics carry only route and status class, `backend/src/platform/metrics/registry.ts:228-230`), shown by #281. |
| O5 | A restored backup brings back revoked credentials and disabled accounts | L/M | NEW: #516 (the runbook lists what to re-apply after a restore). |
| O6 | Audit trail of enrolment | L/L | EXISTING: code created, enrolled and revoked are audit events with ids only (`agents/services/agentsService.ts`, `agents/services/enrollmentService.ts`). |

### 5. Retention of other players' data

| # | Risk | L/I | Disposition |
|---|---|---|---|
| R1 | Player names on a stranger's server are stored | L/H | EXISTING: kept in memory only (the latest-snapshot store, ADR-0031 section 3; `telemetry/services/agentSnapshotStore.ts`), never logged (M14); the privacy page says so (`frontend/public/privacy.html:83-87`). |
| R2 | Player-chosen train and station names | L/M | EXISTING: in memory only (`map/services/mapLiveStore.ts:39-40`). |
| R3 | A deleted server's world layers and push opt-ins outlive it (and a revived id inherits them) | M/M | NEW: #516 (the soft delete's list misses `map.world_layers` and `alerts.push_optins`). |
| R4 | A modified mod puts personal data in free-text fields (class names, session name) | L/M | ACCEPT: 200-character game-world fields (`packages/shared/src/agent.ts:85`), deleted with the server (R3), backups age out in 37 days (`frontend/public/privacy.html:150-152`); the privacy page makes the server owner responsible for telling their players (`privacy.html:85-87`). |
| R5 | Players on a third-party server aren't told the mod sends their names (superseded: the mod sends player counts only, never names; Amendment 1) | M/M | ACCEPT here: the privacy page covers the backend; the ficsit.app listing's wording belongs to the mod's distribution step (ADR-0042 sub-project 4), and LEGAL.md keeps "player data the mod sends" [NEEDS VERIFICATION] (ADR-0042 Named risks). Owner question below. |

## Consequences
- The mod's first public release waits for #514, #515 and #516, in addition to ADR-0042's gates. #517 waits for the
  owner's sign-up decision.
- ADR-0031's "the agent is the server's own" holds only for honesty about its own server; isolation between servers
  is now a stated requirement of every ingest change.
- Owner questions:
  1. Does the first public release keep sign-up closed (strangers enrol only with codes the operator hands out on
     servers the operator created), or must a player on a rented host be able to get a server? Today there is no path
     for the second (Context), so it needs #517 before release.
  2. (Answered in Amendment 1: the listing says player counts only.) Does the ficsit.app listing say that the mod sends players' names (shown live, not stored)? (R5)
  3. The ACCEPTs: M2, M5, M8, E4, O1, R4, R5, and the admin case in B4.

## Revisit when
- The owner opens sign-up or invites (#517 becomes active; M2, M3 and B5 change).
- A second backend instance: the in-memory limiters become per instance, so the limits above multiply.
- A host is found that lets other tenants read `Saved/` (M5), or the mod's spec differs from what this cites (M4, M13).
- #514's counters show real abuse (E4).

## Amendment 1 (2026-10-20): the owner's answers

1. **Self-serve before the first public release** (question 1, the owner's choice of option B). A player on a rented
   host must be able to get a server without the operator. So #517 (the self-serve design, then its build) and
   gate B (#186, open sign-up) join #514, #515 and #516 as gates on the mod's first public release, and #517 is no
   longer parked. The "Revisit when" line on opening sign-up now applies: M2, M3 and B5 are revisited in #517.
2. **The listing names what is sent** (question 2: "yes, mention player names"). The question's premise was wrong,
   as the owner and the mod session both confirmed: the mod takes player counts only, never names. Mod core v1 sends
   `connectedPlayers` and `playerLimit` (mod repo `Snapshot.cpp:65-66`), and its spec forbids user names or account
   ids beyond the contract (S13). So v1's listing
   says it sends player counts only; if a later contract and mod add names, the listing says so (R5, the mod's distribution
   step). The edge agent's snapshots do carry names, which R1 and M14 already cover.
3. **The ACCEPTs** (question 3): accepted by merging #519.
4. **Mod-side behaviour, verified** against the mod repo's `docs/specs/2026-10-20-core-mod-v1-design.md`, so the two
   [NEEDS VERIFICATION] marks above are resolved:
   - The enrolment code is blanked after enrolling (lines 24 and 60). A crash between writing the credential and
     blanking it blanks the code on the next boot, so the code never enrols twice (line 115).
   - An unknown command answers `{ok:false, code:"unsupported"}` (lines 118 and 165, S6, unit-tested). Only
     `set_auto_pause` with a boolean `enabled` runs.

See also (2026-10-20): ADR-0046 (`0046-self-serve-agent-servers.md`, proposed) is #517's design and gives M2, M3, B5
and O3 their new dispositions.
