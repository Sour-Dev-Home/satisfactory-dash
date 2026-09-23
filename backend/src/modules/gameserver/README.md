# gameserver module

Owns all communication with ONE Satisfactory server: the vanilla Dedicated Server HTTPS
API and the FicsitRemoteMonitoring (FRM) JSON API. This is the one place in the
codebase allowed to know about FRM/vanilla-API response shapes — see the "isolate the
game-server adapter" rule in the root `CLAUDE.md`.

It is the future edge agent (ADR-0014), so it has no Express imports and imports
only `platform/errors.ts` and `@satisfactory-dash/shared` (enforced by
`src/architecture.test.ts`). Other modules import it only through `index.ts`.

The adapter implements a shared internal interface (e.g. `getFactoryState()`,
`getPlayers()`) so the other modules' services never depend on which underlying API — or
which specific game server — the data came from. That indirection is what makes
"one server now, many via AWS later" a config change instead of a rewrite.

## Layout

- `index.ts` — the public API: `createGameServerConnection(config)`, the config loader
  and the domain types.
- `domain.ts` — the only types other modules should import from here:
  `ServerHealth`, `ServerStatus`, `FactoryBuilding`, `PowerCircuit`,
  `BuildingPowerUsage`, `Player`, `SessionInfo`. Every adapter failure extends
  `UpstreamError` (`platform/errors.ts`). Only an `UpstreamError` becomes an
  `upstream_*` error code (502/503); any other error is treated as our own bug.
- `serverOptionsAdapter.ts` — `ServerOptionsPort` (ADR-0012), the ONLY caller of
  `GetServerOptions`; see the rule below. Exposes just the auto-pause read, the
  auto-pause write (`ApplyServerOptions` with only `FG.DSAutoPause`) and `canEditOptions`
  (token configured, `VerifyAuthenticationToken` accepts it, and its `pl` claim is
  `Administrator` or `APIToken`). Configure `SATISFACTORY_API_TOKEN` with an application
  token from `server.GenerateAPIToken`, which third-party apps are told to use
  (`dedicated-server-api.md:279-284`), not a password-login token. Every upstream error
  from this file is rebuilt without its `cause` or `errorData`. Consumed by
  `modules/settings`.
- `rawSchemas.ts` — zod schemas for every raw response, grounded in
  `docs-vault/raw-sources/` and corrected against live responses (see
  `docs-vault/wiki/vanilla-dedicated-server-api.md` and `frm-api.md` — notably: vanilla
  API fields are camelCase, not the docs' PascalCase). `satisfactoryServerAdapter.ts`
  validates every response through one `parseUpstream()` call, so a malformed or
  out-of-range response is an `UpstreamError` (502), never a `TypeError`. Every
  `>= 0` range the public contract asserts is enforced here.
- `rawTypes.ts` — private raw types, derived from `rawSchemas.ts` with `z.infer`.
- `vanillaApiClient.ts` / `frmApiClient.ts` — low-level HTTP clients, one per API.
  Both take an injectable transport/fetch so they're testable without a real socket.
- `satisfactoryServerAdapter.ts` — `SatisfactoryServerAdapter`, the class
  the other modules' services actually depend on. Maps raw → domain.
- `connectionConfig.ts` — env-var config for one connection (host/ports/tokens); see
  `backend/.env.example`. (The server registry, `loadServerRegistryFromEnv`, is the
  servers module's.) The vanilla API's TLS certificate is verified by default, except
  for loopback/private hosts, where the game server's self-signed cert is expected.
  The backend refuses to start (`ConfigError`, `platform/errors.ts`) if the host isn't
  loopback/private at all: FRM is plain HTTP, so its token may never cross a public
  network (ADR-0013).
- `__fixtures__/rawFixtures.ts` — fixture data for tests, sourced from
  `docs-vault/raw-sources/captured-responses/` (real captures) where available,
  otherwise the docs' own example responses.

## Rule: `GetServerOptions` is a secret

The vanilla `GetServerOptions` response contains FRM's `uWS.AuthenticationToken` in
plaintext (observed live 2026-09-22), so a vanilla admin token effectively grants the
FRM token. The backend must **never proxy, log, store or return** `GetServerOptions`
output. It may call it only through one adapter function that parses an explicit
allowlist of option keys (today: `FG.DSAutoPause` in `ServerOptions` and
`PendingServerOptions`) and discards everything else before returning. Any test for
that function should feed a fixture containing a fake token value and assert the value
appears in no returned object and no log line. Never pass arbitrary option keys through.

## Known gaps (see `docs-vault/wiki/data-gap-analysis.md`)

- `getFactory` and `getPower` were validated against a populated save on 2026-09-22
  (see `docs-vault/wiki/frm-api.md`), and the three mapping bugs that surfaced (B1-B3:
  the backed-up rule, "Unassigned" recipes, circuit keying by `CircuitGroupID`) are
  fixed. `getPlayer` is still unvalidated against real players.
- FRM's documented tunneled transport (through the vanilla API's port) 404s on this
  version; the adapter only implements FRM's direct Web Server.
- The `X-FRM-Authorization` header name is documented but not live-verified — the
  spike's server never enforced auth.
