# Runbook: OWASP Top 10 sanity check

A repeatable check of this codebase against the **OWASP Top 10:2025**. Each item names what to look at in *this* repo, so
a rerun is a walk down the list, not a fresh audit. Rerun it before opening sign-up to strangers, after a large auth,
infrastructure or ingest change, and at least every six months. Record each run in the table at the end.

How to run it: three read-only `security-reviewer` passes in parallel (A01/A06/A07, A02/A04/A05, A03/A08/A09/A10), each
given this page. Also run `npm audit` and the PII/path scan. They read code only: no tests, builds or servers. File each
GAP as an issue and link it here.

Status key: **PASS** holds today, **GAP** needs work (severity and issue), **N/A** doesn't apply.

## A01 Broken Access Control

| Check | Where | Status |
|---|---|---|
| Every `/api/servers/:serverId` route sits behind one membership check: a non-member gets the same 404 as an unknown server, a viewer's write gets 403, and a DB outage gives 503 | `servers/serversRouter.ts` (`createAuthorizeServer`), `servers/serverAccess.ts`, mount order in `server.ts` | PASS |
| The authorization tests are generated from the contract, so an unscoped or unmounted route fails CI | `backend/src/serverAuthorization.test.ts` (`scopedEndpoints`) | PASS |
| Member self-service writes (leave, push opt-in) come from the contract's `memberSelfService` flag, matched on exact method and path | `serverAccess.ts` (`MEMBER_SELF_SERVICE`) | PASS (#556) |
| No IDOR: rules, commands, push subscriptions and opt-ins are filtered by server and owner in SQL | `alerts/repositories/*`, `agents/repositories/commandRepository.ts` | PASS |
| Operator-only and owner-only actions are checked server-side; `canManageServers` is only a UI hint | `serverManagementRouter.ts`, `servers/selfServe.ts` | PASS |
| An agent credential is bound to exactly one live, agent-kind server | `agents/repositories/agentRepository.ts` (`FIND_ACTIVE`) | PASS |
| CORS uses an exact allowlist (never `*`). The cross-site guard checks Sec-Fetch-Site and Origin on every non-GET, and bodies must be JSON | `app.ts`, `platform/httpPolicy.ts` | PASS |
| Disable and delete revoke sessions and agents; the session lookup requires an active user | `identity/accountAdmin.ts`, `identity/accountDeletion.ts`, `sessionRepository.ts` | PASS |

## A02 Security Misconfiguration

| Check | Where | Status |
|---|---|---|
| The frontend CSP is strict (`script-src 'self'`, no unsafe-inline/eval, `frame-ancestors 'none'`), with XFO, nosniff, Referrer, Permissions and COOP set. The demo uses `connect-src 'self'` | `frontend/public/_headers`, `frontend/demo/_headers` | PASS |
| **HSTS is long-lived on both hosts** | `frontend/public/_headers:7` is `max-age=86400`, and the API host has none | **GAP Low, #562** |
| API responses: nosniff, `no-store`, `no-referrer`, `default-src 'none'`, no `x-powered-by` | `platform/httpPolicy.ts`, `app.ts` | PASS |
| The error envelope shows `detail` only for allowlisted NODE_ENVs, and the images set `NODE_ENV=production` | `platform/errorResponse.ts`, `backend/Dockerfile` | PASS |
| Loopback-only: HOST defaults to 127.0.0.1, compose publishes no ports, and CF-Connecting-IP is trusted only from a loopback peer | `server.ts`, `compose.yaml`, `platform/clientIp.ts` | PASS |
| AWS: no inbound rules, RDS private and encrypted, IAM scoped to exact ARNs, the state bucket versioned and private | `infra/aws/network.tf`, `rds.tf`, `iam.tf`, `ops_iam.tf`, `bootstrap/main.tf` | PASS |
| Risky features default off: `ALERT_DELIVERY`, `SELF_SERVE_ENABLED`, `SIGNUP_MODE` | `alerts/config.ts`, `servers/selfServeRouter.ts`, `identity/index.ts` | PASS |
| Mock and demo code stays out of production builds | `frontend/vite.config.ts`, `e2e/build-output.spec.ts` | PASS |

## A03 Software Supply Chain Failures

| Check | Where | Status |
|---|---|---|
| The lockfile is committed and installs use `npm ci` everywhere, including `--ignore-scripts` in the image | `package-lock.json`, workflows, `backend/Dockerfile` | PASS |
| `npm audit` is clean | run it | PASS (0, 2026-10-21) |
| Every action is pinned to a full SHA, and Dependabot covers npm and actions | `.github/workflows/*`, `.github/dependabot.yml` | PASS |
| Tokens are least-privilege: top-level `contents: read`, `packages: write` only on main's image push, `persist-credentials: false` | workflows | PASS |
| **Base images are pinned by digest** | `backend/Dockerfile` uses `node:22-slim` by tag, and Dependabot has no docker ecosystem | **GAP Medium, #561** |
| The deployed images are pinned by digest (Terraform enforces it) | `infra/aws/variables.tf`, `ecs.tf` | PASS |
| **Static analysis (CodeQL)** | no workflow | **GAP Low, #561** |
| No CDN scripts. Vendored skills and MCP config never ship | `frontend/index.html`, `backend/Dockerfile.dockerignore` | PASS |

## A04 Cryptographic Failures

| Check | Where | Status |
|---|---|---|
| Secrets at rest use AES-256-GCM with a random nonce, required AAD and key ids for rotation; placeholder keys are refused | `platform/secrets/secrets.ts` | PASS |
| Passwords use scrypt (N=2^15, r=8, p=1), a random salt and a constant-time compare; parameters are checked at startup | `identity/passwordHash.ts` | PASS |
| Session, login-attempt and agent secrets are 32 random bytes stored as SHA-256. Enrolment codes are 60 bits of unbiased base32 | `sessionRepository.ts`, `loginAttemptRepository.ts`, `agents/services/enrollmentCode.ts` | PASS |
| Web push uses RFC 8291 aes128gcm plus RFC 8292 VAPID, from node:crypto primitives only | `alerts/services/webPushCrypto.ts` | PASS |
| The agent keeps its secrets with DPAPI (CurrentUser), passed over stdin and never in argv | `agent/src/dpapi.ts` | PASS |
| Backups are age-encrypted, and the database connection supports `verify-full` | `platform/backup/backup.ts`, `platform/db/tlsUrl.ts` | PASS |
| **Direct (non-agent) game connections on a LAN:** the self-signed cert is trusted for any private host, and the FRM token goes over plain HTTP | `gameserver/connectionConfig.ts`, `game-adapter/src/frmApiClient.ts` (startup warns) | GAP Low, accepted, #562 |

## A05 Injection

| Check | Where | Status |
|---|---|---|
| All SQL is parameterised, and a guard test fails on interpolated `query(` calls | `sqlGuard.test.ts`, `platform/db/admin.ts` (DDL with `escapeIdentifier`) | PASS |
| No shell: server-manager and ops use argument arrays with `shell:false` and constant scripts | `server-manager/src/*`, `backend/scripts/*` | PASS |
| No `dangerouslySetInnerHTML`, innerHTML or eval. Map tooltips are built from text nodes | `frontend/src/map/*Layer.tsx` | PASS |
| Discord and push payloads are cleaned (`plainAlertText`), with `allowed_mentions.parse = []` | `alerts/services/alertMessage.ts` | PASS |
| zod checks every boundary: request bodies, agent snapshots, game and FRM responses, backend replies to the agent | `agents/routes/agentApi.ts`, `game-adapter/src/rawSchemas.ts`, `agent/src/backendClient.ts` | PASS |
| **Lookups keyed by external strings use a Map or `Object.create(null)`** | `telemetry/parseGameDocs.ts:47,57` uses a plain `{}` (offline script) | GAP Low, #562 |
| Logs are structured, with redaction; the agent's log keys are allowlisted | `platform/logger.ts`, `agent/src/logger.ts` | PASS |

## A06 Insecure Design

| Check | Where | Status |
|---|---|---|
| ADR-0046 caps C1–C8 are enforced under the management lock, C5 counted in the database, and the C4 sweep runs even with self-serve off | `servers/selfServe.ts`, `agents/services/agentsService.ts`, `identity/googleSignIn.ts`, `server.ts` | PASS |
| #514 agent limits: per credential, per network, then global with a refund | `agents/routes/agentApi.ts` | PASS |
| SSRF: webhooks go to exactly discord.com or discordapp.com, push to allowlisted hosts (checked again at send), no redirects followed, server addresses DNS-pinned | `discordWebhook.ts`, `pushSender.ts`, `servers/addressGuard.ts` | PASS |
| Races: the ownerless trigger, lock order for enrolment, deletion and transfer, guarded code consumption | migrations `…members_never_ownerless`, `accountDeletion.ts`, `memberRepository.ts` | PASS (#556; transfer-API follow-up in #311) |
| **One agent-auth failure budget** | the world-layer `createAgentAuth` (`server.ts:476`) doubles it | GAP Low, #562 |
| **The threat model matches the code** | ADR-0045 M1 still says 40-bit codes and 120/min | GAP Low (docs), #562 |

## A07 Authentication Failures

| Check | Where | Status |
|---|---|---|
| DB sessions: a 32-byte id stored as SHA-256, a new id on every login, a fixed 8 h TTL, revoke and sign-out-everywhere, a DB outage gives 503 not 401 | `identity/dbSessionStore.ts`, `sessionRepository.ts` | PASS |
| The cookie is httpOnly, Secure, SameSite=Lax, `path=/api` | `identity/session.ts` | PASS |
| Google OIDC: state, nonce and PKCE stored server-side and used once; issuer, audience and expiry checked; `email_verified` required; accounts found by `sub` | `identity/googleOidc.ts`, `googleSignIn.ts`, `loginAttemptRepository.ts` | PASS |
| Sensitive actions require a recent sign-in: account deletion needs one in the last 10 min, and using the site doesn't count | `identity/accountDeletion.ts` | PASS (#556) |
| **The operator login is capped beyond per-IP** | `identity/loginRateLimiter.ts` is per /56 only, and a full table evicts blocked buckets | GAP Low, #562 |
| Enrolment codes are single-use, expire after 10 min, one open per server, and are never logged | `agents/repositories/agentRepository.ts` | PASS |

## A08 Software or Data Integrity Failures

| Check | Where | Status |
|---|---|---|
| CI integrity: the required checks are verify, e2e and security (ADR-0043); `pull_request_target` runs no PR code | `cla.yml`, ruleset | PASS |
| Untrusted data is parsed with zod, never trusted | see A05 | PASS |
| Backups are AEAD (age), and their freshness is checked daily | `backup-check.yml` | PASS |
| Authenticated responses are `no-store`; membership is checked before any ETag/304 | `platform/httpPolicy.ts`, `map/routes/worldRoutes.ts` | PASS |
| **Images are signed or attested** | `image.yml` pushes without provenance | GAP Low, #561 |
| **Applied migrations are immutable** | no CI check | GAP Low, #561 |
| **Agent downloads are checksummed or signed** (before any public download) | `runbooks/agent-app.md` | GAP Low, #561 |

## A09 Logging & Alerting Failures

| Check | Where | Status |
|---|---|---|
| Structured pino logs that redact authorization, cookies, FRM auth, Location and player names; 14-day retention | `platform/logger.ts`, `infra/aws/logs.tf` | PASS |
| The audit log covers sign-in, sign-up, sessions, user disable, server lifecycle, membership, agents, push and account deletion | identity, servers, agents and alerts repositories | PASS |
| Alarms for no running task, RDS storage and CPU, and backend errors (`level >= 50`), sent to SNS email | `infra/aws/alarms.tf` | PASS |
| Repeated worker failures page someone: one `error` (`WORKER_FAILING`) after about 5 minutes of failing, the `backend-critical` alarm on one such line, an hourly alert-evaluator heartbeat | `platform/failureStreak.ts`, `infra/aws/alarms.tf` | PASS (#560) |
| Auth anomalies alarm: failed and refused sign-ins, 20 in 5 minutes (`auth-failures`) | `infra/aws/alarms.tf` | PASS (#560) |
| The `/api/health/ready` uptime monitor | external, documented in `ecs.tf` | Check by hand |

## A10 Mishandling of Exceptional Conditions

| Check | Where | Status |
|---|---|---|
| One error envelope and taxonomy; DB causes never reach the body; Express 5 forwards async errors | `platform/errors.ts`, `platform/errorResponse.ts` | PASS |
| Fails closed: a DB outage gives 503 for auth, and allowlists refuse unknown hosts | `dbSessionStore.ts`, `googleOidc.ts` | PASS |
| Workers catch errors per tick and reschedule; the history poller has a per-poll deadline | `alertEvaluatorWorker.ts`, `factoryHistoryPoller.ts` | PASS |
| Every outbound call has a timeout, and the DB has statement timeouts | `frmApiClient.ts`, `vanillaApiClient.ts`, `discordSender.ts`, `pushSender.ts`, `googleOidc.ts`, `db/pool.ts` | PASS |
| Retries are bounded (exponential, capped at 30 min, dead after 24 h), and a dead webhook is disabled | `alerts/services/retryPolicy.ts`, `alertDeliveryWorker.ts` | PASS |
| Missing readings hold the last state, so they never cause flapping | `serverAlertEvaluator.ts` | PASS |
| Body and snapshot size limits (100 kB, 4 kB, 5 MiB after decompression) | `app.ts`, `agents/routes/agentApi.ts`, `agents/config.ts` | PASS |
| A fatal handler for unhandled rejections and exceptions: one JSON `fatal` line, a flush, exit 1 (the agent: a no-detail line, exit 1) | `platform/fatalHandlers.ts`, `server.ts`, `agent/src/fatal.ts` | PASS (#560) |

## Runs

| Date | Commit | Result | Issues |
|---|---|---|---|
| 2026-10-21 | main `1e070650` (A01/A06/A07 rows updated for #556) | No High. Medium: base images by tag (A03), silent worker failures (A09). The rest Low. `npm audit` clean; PII scan clean | #560, #561, #562 |
