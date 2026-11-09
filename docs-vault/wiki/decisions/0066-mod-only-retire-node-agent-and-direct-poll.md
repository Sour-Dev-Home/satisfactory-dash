# ADR-0066: The mod is the only way a server connects (retire the Node agent, the Electron app and direct polling)

Status: **Proposed**. Owner decisions, 2026-11-08, given directly: "retire the servers read through an agent, since we wont be
using one anymore". Asked to choose, the owner picked all three of: (1) retire the Node edge agent and the Electron server
manager, (2) retire the owner's existing Node-agent server, (3) retire direct-poll servers. This ADR amends ADR-0058 Decision 5,
ADR-0031, ADR-0057, ADR-0030, ADR-0012, ADR-0014, ADR-0038 (M3, the local poller) and ADR-0032, and supersedes ADR-0040. Nothing
is built until the owner accepts it. Evidence is cited to this repository (`file:line`) on `origin/main` at `936314b7`, plus PR
#870. Game, FRM and SML facts are not restated here; any needed later is [NEEDS VERIFICATION] unless it cites
`docs-vault/raw-sources/`.

## Context

- **The mod is now the product.** Only the mod is released to players; the Node agent and Electron app are for development only
  (ADR-0058 "Mod only for players", `0058:401-403`). Mod 0.2.0 (shipped 2026-11-06, `0058:441-455`) has no FRM code.
  - **Its API surface,** confirmed by the mod session for 0.3.0:
    - `POST /agent/v1/enroll` with `{code, agentVersion:"mod/0.3.0"}`, which answers 201 `{agentSecret, serverId, cadence}`;
    - `POST /agent/v1/snapshots`;
    - `POST /agent/v1/world/<layer>` for resourceNodes, trainRoutes, rails, conveyors, mapMarkers, droneRoutes and powerLines;
    - `GET /agent/v1/commands?waitSeconds=25` and `POST /agent/v1/commands/<id>/result`;
    - Bearer `agentSecret` after enrolment, and a 401 means revoked.
  - **Pairing:** the owner folded device-code pairing (ADR-0051 section 1) into 0.3.0 on 2026-11-09. The mod will call
    `POST /agent/v1/pairings` and poll per `packages/shared/src/pairing.ts`; #871 lets that request carry the `mod/` version string.
- **Three read paths exist today.**
  - (a) **The mod:** kind `agent`, with an `agentVersion` that starts with `mod/` (`frontend/src/updates/notices.ts:17` `clientOf`).
  - (b) **The Node agent:** the same kind with a different version string. It is built from `agent/` (which reads the game with
    `packages/game-adapter`) and `server-manager/`, 117 tracked files between them.
  - (c) **Direct poll (kind `local`):** the backend holds a server's address and sealed tokens and reads it itself.
    `buildPolledServer` calls `createGameServerConnection` (`backend/src/server.ts:193`), starts `LocalWorldPoller` (`:198`) and
    sets up the settings write `createServerOptionsPort` (`:216`).
- **Only (a) is wanted.** ADR-0058 Decision 5 froze the Node agent and the adapter "for as long as the agent and the local poller
  exist", and said a later ADR would retire them (`0058:163-184`). This is that ADR.
- **The adapter is not one block.**
  - `packages/game-adapter` (62 files) and `backend/src/modules/gameserver` (11 files; `index.ts` is an explicit re-export list)
    hold the vanilla and FRM clients, the raw schemas, `ServerOptionsAdapter` and the connection test. Those go.
  - The same two places also hold things the agent path uses:
    - the domain types `FactoryBuilding` and `PowerCircuit` (`telemetry/services/classifyBuilding.ts:1`, `classifyPower.ts:2`,
      `snapshotDerive.ts:2`);
    - `isBackedUp` and `areInputsFull`;
    - `diffDecidedStates` and `sumItemRates`, which sit in the polled `factoryHistoryPoller.ts` but are imported by `agentIngest.ts:2`.
  - Deleting the package first would therefore break agent-server telemetry.
- **Conversion already exists.** Enrolling on a `local` server (operator only, `agents/services/agentsService.ts:106`) sets
  `connection_kind='agent'` and deletes the stored connection in the enrolment transaction (`enrollmentService.ts:47`,
  `serverRepository.ts:279-297`). The owner's Node-agent server therefore already holds no connection row.
- **`SERVER_SECRETS_KEY` is not only for server tokens.** The keyring also seals alert webhooks and web-push data.
  `ALERT_DELIVERY=on` requires it (`server.ts:292`), and delivery and push take it (`:333, :338`). `infra/aws/ecs.tf:14-18` lists it
  among `backend_optional_secret_keys`. It stays.
- **Auto-pause.**
  - For agent servers, `SettingsServices` is already command-shaped: in `settings/settingsServices.ts` and
    `agents/services/agentSettings.ts`, `setAutoPause` creates a command and the route answers 202.
  - The `local` side is `SettingsService(ServerOptionsPort)` (`settings/index.ts:9`, `settings/services/settingsService.ts`). Its
    200-with-Settings answer and its `UpstreamError` mapping (`:45-48`) exist only for local servers.
  - The contract documents "200, or 202 for an agent" (`packages/shared/src/endpoints.ts:554-559`).
- **Architecture guards.**
  - `backend/src/architecture.test.ts` carries rule 3 (gameserver liftable into the edge agent, `:15-26, :154`) and rule 7 (only
    `gameserver/` and `platform/errors.ts` import the adapter, `:56-63`).
  - `docs-vault/workspace.dsl` lists the game-adapter, agent, gameserver and "direct-game-access" relations (lines 24, 76-93,
    143-151, 190-194).
- **CI and tooling that name the retired workspaces:**
  - `.github/workflows/ci.yml:95` (the server-manager e2e under xvfb) and `:226-247` (`systemd-verify`);
  - `scripts/ci-select.mjs:23, 47` and `scripts/ci-select.test.mjs:81-94`;
  - `scripts/dev/remote.mjs:131`;
  - `scripts/deploy/inputs.mjs:28` (game-adapter is a required deploy input);
  - `backend/Dockerfile:19, 23, 62`;
  - root `package.json:17-19`.

  A grep of `scripts`, `.github`, `compose*`, `frontend/e2e`, `backend/scripts` and `infra` finds no other user of `agent/` or
  `server-manager/`.
- **Deploy ordering.**
  - A merge that changes the backend images deploys to production automatically (ADR-0049; `CLAUDE.md` "Workflow"), and the
    frontend deploys separately on every merge.
  - Migrations are expand-only: a drop or a new CHECK needs a `-- contract: <why safe now>` line (`backend/CLAUDE.md`, ADR-0049 D6).

## Decision

### 1. One way in: the mod (kind `agent`, the `/agent/v1` protocol)

The backend knows a game server only as a sender of `/agent/v1` requests. These stay unchanged:
- kind `agent`, and enrol, snapshots, world, commands and command results;
- enrolment codes;
- the pairing API and `/app/pair`, which mod 0.3.0 will use;
- the `agent_offline` alert;
- self-serve (ADR-0046).

The Node agent was never told apart from the mod except by `agentVersion`. Nothing in the protocol changes, so no server-side
distinction is added.

### 2. Retire the Node agent and the Electron app (owner choice 1)

- **Delete** `agent/` and `server-manager/`; ADR-0040 is superseded.
- **CI and tooling:** delete the CI steps and jobs (the server-manager e2e in `ci.yml`, `systemd-verify`, the `systemd` output in
  `changes.yml`), their `ci-select.mjs` rules, workspace entries and tests, the `remote.mjs` workspace list, the root script
  entries and the lockfile entries.
- **Runbooks:** delete `agent-app.md`, `agent-linux.md`, `server-manager.md` and `agent-switch-over.md` (the last covers the switch
  from local to the Node agent, `agent-switch-over.md:1-4`). `runbooks/agents.md`, the backend side of the protocol, stays and is
  retitled for the mod.
- **Frontend:** delete the dev-agent branches:
  - `offersDevAgent`, `AGENT_WORDS` and `senderWords`' two-way choice in `frontend/src/agent/agentText.ts:87-128`;
  - the `devAgent` prop of `AgentSettings`, `EnrolmentGuide` and `PlayerNotice`, plus `Shell.tsx:521` and `paletteCommands.ts:98`.

  Everyone sees the mod wording. `clientOf`'s non-mod branch stays, so an old Node-agent row still shows a sensible "update" notice.

### 3. Retire direct poll (owner choice 3)

- **Runtime.** No server is built with a game connection. These go:
  - `buildPolledServer` and `LocalWorldPoller`;
  - the polled telemetry services (`powerService`, `productionService`, `playersService`, `serverStatusService`) and the polled
    halves of the two history pollers;
  - `observeFactoryReads`;
  - the env and `SATISFACTORY_SERVERS_FILE` server path (`platform/envServers.ts`, `gameserver/connectionConfig.ts`,
    `serversFile.ts`);
  - the import CLI (`servers/importServers.ts`);
  - the `ServerRuntime` leader-gating for polled servers (ADR-0054 D3), which stays only if the agent workers still need it.
- **No database, no game servers.**
  - `buildAgentServer` already requires a database, so the backend needs `DATABASE_URL` to serve any server. Without it, the backend
    serves health and the identity routes and nothing else.
  - `backend/.env.example`, `go-live-api.md`, `servers.md` and the env-server tests (`server.test.ts`, `serverMulti.test.ts`,
    `serverReady.test.ts`) change.
  - Local frontend work uses the demo build (ADR-0026) or the compose Postgres.
- **Operator routes removed:** create, edit/update, get (the stored connection), `POST /api/servers/test-connection`,
  `POST /api/servers/:id/test-connection` and `POST /api/servers/:id/local-connection` ("Switch back to local").
- **Operator routes kept:** `GET /api/servers/managed` (agent servers), `POST /api/servers/agent`, rename, delete, and the
  enrolment-code and revoke routes.
- **`addressGuard.ts`** (ADR-0030's LAN gate) goes with them unless the PR finds another user. Today only `importServers`,
  `loadDatabaseServers` and `serverManagement` import it.
- **Errors.** Nothing throws `UpstreamError` after this, so its re-export (`platform/errors.ts:7`) and its mapping
  (`platform/errorResponse.ts:130`) are deleted. The contract's error codes stay: the agent snapshot store still throws `ApiFailure`.
- **Upstream timing** (ADR-0032, `recordUpstreamCall`) has no producer left. `upstreamP95Ms: { vanilla, frm }`
  (`packages/shared/src/metrics.ts:223`) stays in the contract for now, and the backend sends empty series. It is removed in the
  contract PR (Decision 8), together with its series on the operator metrics page.

### 4. Auto-pause: the command survives, the direct write does not

- **Deleted:** `ServerOptionsPort`, `ServerOptionsAdapter`, `createServerOptionsPort`, `settings/services/settingsService.ts` and its
  `UpstreamError` mapping.
- **Kept:** `SettingsServices`, with `createAgentSettingsServices` as its only implementation; `settings/index.ts` takes the commands
  service instead of a port. The PUT always answers 202 `{command}`.
- **Contract:** no change in this ADR. `SetAutoPauseResponseSchema` keeps its 200 member, for old frontends and for the documented
  rule that the client handles both answers (`endpoints.ts:554-559`). That member is annotated "never sent since ADR-0066" and
  dropped in the contract PR.
- **ADR-0012 is amended:** the toggle's default (off), its visibility and its audit stay, and "the dashboard's one write to the game
  server" becomes "one command the mod runs".
- **Open:** whether mod 0.3.0 runs the auto-pause command is the mod session's to confirm before PR 5 [NEEDS VERIFICATION].

### 5. The adapter package and the gameserver module go, after their shared parts move out

Order matters (PRs 3 and 7 below).
1. **Move what the agent path needs into `backend/src/modules/telemetry/`:**
   - a `domain.ts` for `FactoryBuilding`, `PowerCircuit`, `BuildingPowerUsage` and `InventorySlot`;
   - a `factoryStates.ts` for `isBackedUp`, `areInputsFull`, `diffDecidedStates` and `sumItemRates`.
2. **Replace the FRM-shaped test inputs.** Their tests read FRM-shaped files from `packages/game-adapter/fixtures`. There are 9
   importers; in the backend they are `classifyEdges`, `factoryClockSpeed`, `factoryLocation`, `productionService` and three route
   tests. The relocation PR commits the mapped, domain-shaped result as backend-local fixtures, with a comment citing the
   `raw-sources/captured-responses/` file each came from, so no FRM-shaped data stays in `backend/`.
3. **Then delete:** `packages/game-adapter` and `modules/gameserver` go, and `@satisfactory-dash/game-adapter` leaves
   `backend/package.json:27`, `backend/Dockerfile:19, 23, 62`, the root scripts and `scripts/deploy/inputs.mjs:28`.

### 6. Architecture checks

- **`backend/src/architecture.test.ts`:** delete rules 3 and 7, since the gameserver module and the adapter package no longer exist.
  With them go:
  - the `GAMESERVER_ALLOWED_PACKAGES` and `GAME_ADAPTER` constants;
  - the dependency-table entry `gameserver: []`, and the `"gameserver"` members of `telemetry`, `settings` and `map`;
  - the fixture cases at `:191-205`.

  One new rule keeps the old path from coming back: `backend/package.json` lists no game-API client package, and an import of
  `@satisfactory-dash/game-adapter` from `backend/src` does not resolve.
- **`docs-vault/workspace.dsl`:** delete the gameserver component, the `gameAdapter` and `agent` containers, the
  `direct-game-access` relations (`satis.api -> game`, `gameAdapter -> game`, `agent -> game`), the owner's-PC `agentNode`, and the
  managed-agent deployment instances. The mod is modelled as a container in the game server's deployment node that pushes to
  `satis.api.agents`.

### 7. Existing `local` servers in production: convert, never delete (in two steps)

- **Step 1, the retirement (PR 5, expand-only).**
  - A migration runs `UPDATE servers.servers SET connection_kind = 'agent' WHERE connection_kind = 'local' AND deleted_at IS NULL`.
    It changes data, not schema, so it needs no `-- contract:` line.
  - It is safe during a rolling deploy: the old backend loads an `agent` row without a credential exactly as it loads a self-serve
    server awaiting its first enrolment (`buildAgentServer`).
  - The new loader also treats any leftover `local` row (from a restored older backup) as `agent`.
  - History, memberships, alert rules and the public id are untouched.
  - The sealed tokens stay in `servers.server_connections`, unused, so the step can be reversed with a rollback image plus an
    `UPDATE` back.
- **Step 2, the contract (PR 10, a later release).**
  - `DROP TABLE servers.server_connections`, with `-- contract: no running or rollback image reads the table (PR 5 shipped >= 1
    release ago and the owner took a backup)`.
  - This destroys the sealed tokens irreversibly, so it needs the owner's go.
  - The `connection_kind` column and its CHECK are left alone: one value is in use, and no migration is needed if another kind ever
    returns.
- **Why not remove or archive.**
  - Removal (`remove-server`/`purgeServerData`, `serverRepository.ts:270-275`) deletes history for no gain.
  - A new "archived" state would be persistent state with no user.
  - Instead, the operator mints an enrolment code for the converted server and enrols the mod, which keeps the history.

### 8. Contract changes in `packages/shared` (isolated PRs, ground rule 6, additive first)

Files: `packages/shared/src/serverManagement.ts`, `endpoints.ts`, `metrics.ts`, `packages/shared/fixtures/serverManagement.ts`,
`packages/shared/test/serverManagement.test.ts` and `packages/shared/test/fixtures.test.ts`.

- **Step A (no contract edit):** the backend answers `GET /api/servers/managed` with `servers: []`.
  `ManagedServerListResponseSchema.servers` is required today (`serverManagement.ts:136-146`), so the backend sends an empty array
  rather than omitting the field.
- **Step B (breaking, but only for routes nobody calls once the frontend PR and the backend route PR are live).**
  - **Removed:**
    - the schemas `CreateServerRequestSchema`, `UpdateServerRequestSchema`, `TestConnectionRequestSchema`/`ResponseSchema`,
      `ConnectionCheckSchema`, `ServerConnectionSchema`/`ResponseSchema` and `SwitchToLocalRequestSchema`;
    - the `servers` field of `ManagedServerListResponseSchema`;
    - the `endpoints.ts` entries create, get, update, testConnection, testSaved and switchToLocal (`:300-377`);
    - the 200 member of `SetAutoPauseResponseSchema`, and `upstreamP95Ms`.
  - **Kept:**
    - `AgentServerSchema`, rename, remove and `createAgentServer`;
    - `RESERVED_SERVER_IDS` (an id once reserved stays reserved);
    - the `unsupportedFrm` conveyors-skip enum value, because it is stored data. Its frontend note is removed only after the mod
      session confirms the mod never sends it [NEEDS VERIFICATION].
- Step B is declared **breaking** for any client that still calls those routes. The operator's frontend doesn't, once PR 2 is out.

### 9. The owner's old Node-agent server (choice 2): keep the row, revoke the credential

- **Recommendation:** revoke its Node-agent credential now and keep the server for re-enrolment with the mod; don't use
  `remove-server`.
- **Why:**
  - `remove-server` is the irreversible full delete, including history, and the row costs nothing while idle.
  - A new world, or the same one hosted with the mod, re-enrols with one code, because enrolment replaces the credential
    (`installAgentCredential`).
  - Revoking (Settings "Revoke the agent", or `DELETE /api/servers/:id/agent`, `endpoints.ts:577`) makes any stray 0.1.0 agent get
    a 401.
- **If the owner will never reuse that world,** `npm run admin -- remove-server <public-id>` is the answer instead. That's the
  owner's call, and it is permanent.
- **Open:** whether the stale server keeps firing `agent_offline` is checked in PR 5 [NEEDS VERIFICATION]. If it does, the owner
  mutes or deletes that alert rule.

### 10. Demo build and fixtures

- **Demo:** `frontend/src/demo/handlers.ts`, `demo/world.ts` and `demo/serverManagement.test.ts` stop serving `local` connections
  and test results. The demo's managed list shows agent servers only, so the tour (ADR-0065) and its e2e are checked.
- **Test fixtures:** `frontend/src/test/handlers.ts` and `scenarios.ts` drop the local-server scenarios, and the shared fixtures
  follow Decision 8.
- **`docs-vault/raw-sources/`** is immutable and stays untouched: the FRM and vanilla captures remain as historical evidence (the
  mod's parity record, ADR-0058).
- **Wiki pages:** `docs-vault/wiki/frm-api.md`, `vanilla-dedicated-server-api.md` and `frm-endpoint-volumes.md` get a banner
  "historical: nothing reads these APIs since ADR-0066". They are not deleted.
- **`docs-vault/wiki/data-gap-analysis.md`:** its source column names `getFactory` and `getPower`. It is rewritten so the source is
  the mod's reader (ADR-0058, `mod-claims.md`), and a gap means "the mod does not yet send it".

### 11. Wording for the ADRs and CLAUDE.md

- **ADR-0058 Decision 5:** the paragraph "Node agent keeps FRM (decided)" is replaced with: "Superseded by ADR-0066: the Node agent,
  `packages/game-adapter` and the local poller are retired. The mod is the only sender; Linux and unmodded hosts have no path until
  the mod serves them (mod #86)." Its clean-room rules (Decision 6) stand.
- **ADR-0031:** a banner: "Amended by ADR-0066: the edge agent is the mod. PR 2 (the adapter package) and PR 6 (the Node agent) are
  retired; the `/agent/v1` protocol, credentials, commands and the agent kind remain in force."
- **ADR-0040:** Status "Superseded by ADR-0066".
- **ADR-0057:** Decision 1 ("keep the Node agent"), Decision 2 (the Linux agent build steps) and Decision 8 step 3 are marked
  "Superseded by ADR-0066". The mod and zero-touch setup (Decision 6) and updates (Decision 7) stand.
- **ADR-0030, 0012, 0014 and 0032:** one-line banners, as in Decisions 3, 4 and 5. ADR-0038 M3 notes that the local poller is gone.
- **CLAUDE.md ground rule 4, new text:** "**The mod is the data source.** The SatisDashAgent mod (ADR-0058) reads the game natively
  and pushes to `/agent/v1`; the backend never calls the game's HTTPS API or FRM. A metric the mod does not send is a gap in
  `docs-vault/wiki/data-gap-analysis.md` and is added to the mod. Any claim about the game, FRM or SML cites
  `docs-vault/raw-sources/` or the mod repository's notes, otherwise write `[NEEDS VERIFICATION]`." The ADR-0039 mod-as-end-state
  sentence is deleted, because that is now the current state.
- **Ground rule 5, new text:** "**Isolate the sender.** The backend knows a game server only through the `/agent/v1` protocol
  (`packages/shared`, `backend/src/modules/agents/`). No game- or mod-specific response shape leaks into React or the database
  schema. That is what makes one server now, many via AWS later, a config change."
- **Team topology table:**
  - The row `packages/game-adapter/ (and the backend's thin modules/gameserver/ facade) | data-adapter agent` becomes
    `modules/agents/ (the protocol) and the mod repository | mod agent | packages/shared/ only — never guesses`.
  - The "Stack" list drops `agent` and `packages/game-adapter`, and the `agent/` bullet is deleted.
  - The "Custom agents" and "Testing" lines that mention them are tightened.
  - The `docs-vault` description of `raw-sources` keeps "immutable".

## Build plan (each PR from `main`, no stacking; each keeps production working; each adds its `log.d` fragment)

| # | PR | Notes and proof |
|---|---|---|
| 1 | **Docs:** this ADR, the README row, and banners on 0012/0014/0030/0031/0032/0040/0057/0058. | Docs only. |
| 2 | **Frontend:** remove the dev-agent branches and the "Add a server" form, edit, test result, LAN warning and "Switch back to local". The managed view reads agent servers only; update the demo and test handlers. No contract change: the old backend still serves every route, so an old and a new frontend both work. | Vitest, frontend e2e, demo e2e and `build-output.spec.ts`, ui-reviewer. |
| 3 | **Backend relocation (no behavior change):** move the types and helpers of Decision 5 into `telemetry/`, re-point the imports, and convert the nine FRM-fixture tests to domain-shaped backend-local fixtures. | Full backend suite; the golden files under `telemetry/services/__golden__` unchanged. |
| 4 | **Retire `agent/` and `server-manager/`:** workspaces, CI jobs, `ci-select`, `remote.mjs`, lockfile and runbooks (Decision 2). Merge after PR 2 and before PR 7, because the agent imports the adapter. | `scripts/ci-select.test.mjs` updated; CI green with the selection rules; no path left unmapped. |
| 5 | **Backend runtime, data step first:** the migration of Decision 7 step 1, and the loader treating a leftover `local` as `agent`. `buildPolledServer`, `LocalWorldPoller`, the polled telemetry, the settings local service, env and file server loading and the import CLI are removed. `GET /api/servers/managed` sends `servers: []`, and the operator routes still exist but answer `410 gone` ("servers connect through the mod"). | Rolling-deploy safe (see Risks). DB tests: a `local` row loads as a server awaiting the mod, with history and members intact, and a code can be minted and enrolled. Check the `agent_offline` question of Decision 9. |
| 6 | **Backend routes:** delete the 410 routes, the connection logic in `serverManagement.ts`, `addressGuard.ts` (if unused), the connection repository's read and write paths (the table stays until PR 10) and the `UpstreamError` mapping. | Router tests; the bug-hunt (`hunter`) tests are removed with their code. |
| 7 | **Remove `packages/game-adapter` and `backend/src/modules/gameserver`:** the package, Dockerfile, `deploy/inputs.mjs`, root scripts, the `ci-select` rule at `:47`, rules 3 and 7 of `architecture.test.ts`, `workspace.dsl`, `backend/CLAUDE.md`, `frontend/CLAUDE.md` and the module READMEs. | `npm run typecheck`, `lint`, `test`, `build`; the backend image builds without the package; `scripts/deploy` tests. |
| 8 | **Contract (`packages/shared`):** Decision 8 Step B, with fixtures and tests; the operator metrics page loses the two series. Merge only after PRs 2, 5 and 6 have deployed. | `packages/shared` tests; both consumers typecheck in the same PR. |
| 9 | **Docs sweep:** `CLAUDE.md` rules 4 and 5 and the topology table (Decision 11), `data-gap-analysis.md`, `index.md`, banners on the FRM and vanilla wiki pages, `servers.md`, `go-live-api.md`, `backups.md` (the restore drill's "stored connection opened" count, `backups.md:249`, becomes 0 after PR 10), `.env.example`, `agents.md`. | Docs only; the PII scan. |
| 10 | **Contract migration, owner-gated, at least one release after PR 5:** `DROP TABLE servers.server_connections` with the `-- contract:` line. | The owner takes a backup first (`runbooks/backups.md`); `npm run migration-check`; a DB test that the app starts without the table. **Irreversible.** |

## Tests

- **Backend:**
  - a DB test for the PR 5 migration: a `local` row with a connection becomes `agent` and keeps its history and members, and
    enrolment on it succeeds and finds no connection to delete;
  - a loader test that a leftover `local` row builds no connection;
  - PUT auto-pause always answers 202 for an agent server, and a command is created;
  - the removed routes answer 410, then 404;
  - the architecture test fails if `@satisfactory-dash/game-adapter` is imported or listed in `backend/package.json`.
- **Frontend:** the managed view with only agent servers (empty state, one row, several), no `devAgent` prop anywhere, and the demo
  tour still passes.
- **Shared:** schema tests for the surviving schemas.
- **CI:** `ci-select.test.mjs` for the removed workspaces, and a final run proving a PR that touches `packages/shared` still selects
  frontend and backend.

## Files the implementing work will change

- **Contract:** `packages/shared/src/serverManagement.ts`, `packages/shared/src/endpoints.ts`, `packages/shared/src/metrics.ts`,
  `packages/shared/fixtures/serverManagement.ts`, `packages/shared/test/serverManagement.test.ts` and
  `packages/shared/test/fixtures.test.ts`.
- **Deleted:**
  - `agent/`, `server-manager/`, `packages/game-adapter/` and `backend/src/modules/gameserver/`;
  - `backend/src/modules/map/services/localWorldPoller.ts` and `backend/src/modules/settings/services/settingsService.ts`, each with
    its test;
  - `backend/src/modules/servers/{importServers,addressGuard,hunter}*`;
  - `backend/src/modules/servers/serverManagement*.ts` and `serverManagementRouter*.ts`, reduced to rename, remove and agent-create;
  - `backend/src/platform/envServers.ts`;
  - the four runbooks of Decision 2.
- **Backend changed:**
  - `backend/src/server.ts`, `backend/src/architecture.test.ts`, `backend/src/platform/errors.ts` and
    `backend/src/platform/errorResponse.ts`;
  - `backend/src/modules/servers/{loadDatabaseServers,serverRuntime,serverRegistry,serverDirectory,repositories/connectionRepository,repositories/serverRepository,index}.ts`;
  - `backend/src/modules/settings/index.ts`;
  - `backend/src/modules/telemetry/`: a new `domain.ts` and `factoryStates.ts`, and edits to `classifyBuilding`, `classifyPower`,
    `snapshotDerive`, `factoryHistoryPoller`, `powerHistoryPoller` and `index.ts`;
  - `backend/src/modules/map/index.ts`, `backend/package.json`, `backend/Dockerfile`, `backend/.env.example` and
    `backend/CLAUDE.md`;
  - two new migrations.
- **Frontend changed:**
  - `frontend/src/agent/{agentText,AgentSettings}.tsx/.ts`, `frontend/src/selfServe/{EnrolmentGuide,PlayerNotice}.tsx`,
    `frontend/src/shell/Shell.tsx` and `frontend/src/palette/paletteCommands.ts`;
  - `frontend/src/serverManagement/*` (ServerForm, ServerRow, TestResult, LanWarning, messages, AgentServerRow);
  - `frontend/src/demo/{handlers,world}.ts` and their tests, `frontend/src/test/{handlers,scenarios}.ts` and `frontend/CLAUDE.md`.
- **Repo tooling:** `.github/workflows/{ci,changes}.yml`, `scripts/ci-select.mjs` (and its test), `scripts/dev/remote.mjs`,
  `scripts/deploy/inputs.mjs` (and its test), root `package.json`, `package-lock.json` and `CLAUDE.md`.
- **Docs:**
  - `docs-vault/workspace.dsl`;
  - `docs-vault/wiki/{data-gap-analysis,index,frm-api,vanilla-dedicated-server-api,frm-endpoint-volumes}.md`;
  - the runbooks `servers.md`, `go-live-api.md`, `backups.md` and `agents.md`;
  - the decisions README, and one `log.d` fragment per PR.

  `docs-vault/raw-sources/` is unchanged.

## Consequences

- **One path:** there is one code path to read a game, and one set of tests. About 190 tracked files and two CI jobs go, and the
  backend image no longer builds a second workspace.
- **Hosts that can't run the mod have no way to connect:** Linux until mod #86, and unmodded or console-hosted servers. The owner
  accepted this by choosing option 3 and by "mod only for players" (`0058:401`).
- **A database is required:** the backend can't serve any game server without one, and local development without Postgres loses the
  env-server mode.
- **Writes go through the mod:** the dashboard can no longer write to a game server except through a command the mod must accept. If
  the mod lacks the auto-pause command, the toggle does nothing.
- **Existing production servers lose live data** until the mod is enrolled on each. Their history stays.
- **Production secrets:** none are removed. `SERVER_SECRETS_KEY` keeps sealing alert webhooks and push data.

## Risks

- **Rolling deploy with the PR 5 migration.** Old tasks keep running while it applies. They treat the flipped rows as `agent`
  (verified by reading `buildAgentServer`, not by running it), so the only effect is that polling of those servers stops at the
  migration. The owner is told before PR 5 merges.
- **A cached old frontend** that calls a removed route gets 410, then 404. These are operator-only routes, and contract PR 8 waits
  until PRs 2, 5 and 6 are live.
- **PR 3 could hide a behavior change** if a helper moves with a different default. The golden files and the unchanged assertions
  guard against that.
- **`agent_offline` noise** from converted, never-enrolled servers. Unverified; PR 5 checks it.
- **PR 10 is irreversible:** the sealed tokens are destroyed. Restoring a backup older than PR 10 needs the old image; the `local`
  loader guard makes the new code tolerate those rows, but it can't read the missing table.
- **Mod 0.3.0's support for the auto-pause command** is unconfirmed here.

## What the owner must do by hand

- **Before PR 5:** run `npm run admin -- list-servers` against production to see which servers are `local`. Confirm that none of
  them is a server whose live data must continue; if one is, enrol the mod on it first.
- **Retire the old agent:** revoke the old Node-agent credential (Decision 9), and remove the Scheduled Task and the Electron app from
  the game PC.
- **Terraform:** nothing for this ADR. `backend_optional_secrets` keeps `SERVER_SECRETS_KEY`, `SERVER_SECRETS_KEY_ID` and
  `SERVER_SECRETS_PREVIOUS_KEYS` (`infra/aws/ecs.tf:14-18`). A grep finds no `SATISFACTORY_*` setting in `infra/`; if the owner's
  tfvars or SSM hold any, they can be deleted after PR 5.
- **Before PR 10:** take and verify a backup (`runbooks/backups.md`), then give the go.
- **Deploy approvals** for staging and production stay the owner's (ADR-0049).

## Revisit when

- A host class the mod can't serve becomes important (Linux without mod #86, a managed host) and a non-mod sender is wanted again.
  That is a new ADR, not a revert.
- The mod session confirms the mod never sends `unsupportedFrm`, so its frontend note can go.
- `SERVER_SECRETS_KEY` might be renamed (it now seals only webhooks and push), if the churn is ever worth it.

## Open questions for the owner (recommended answer first)

1. **Convert `local` servers to `agent` in PR 5, keeping their tokens until PR 10?** Recommended: yes.
2. **Keep the old Node-agent server and revoke its credential, rather than `remove-server`?** Recommended: yes (Decision 9).
3. **A backend without a database serves no game servers?** Recommended: yes.
