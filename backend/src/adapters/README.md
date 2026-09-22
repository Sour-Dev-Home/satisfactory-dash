# adapters

Owns all communication with a Satisfactory server: the vanilla Dedicated Server HTTPS
API and the FicsitRemoteMonitoring (FRM) JSON API. This is the one place in the
codebase allowed to know about FRM/vanilla-API response shapes — see the "isolate the
game-server adapter" rule in the root `CLAUDE.md`.

Each adapter should implement a shared internal interface (e.g. `getFactoryState()`,
`getPlayers()`) so `routes/` and `services/` never depend on which underlying API — or
which specific game server — the data came from. That indirection is what makes
"one server now, many via AWS later" a config change instead of a rewrite.

## Layout

- `domain.ts` — the only types `routes/` and `services/` should import from here:
  `ServerHealth`, `ServerStatus`, `FactoryBuilding`, `PowerCircuit`,
  `BuildingPowerUsage`, `Player`, `SessionInfo`.
- `rawTypes.ts` — private raw response shapes, grounded in `docs-vault/raw-sources/`
  and corrected against what the live Phase 2 spike actually returned (see
  `docs-vault/wiki/vanilla-dedicated-server-api.md` and `frm-api.md` for the
  discrepancies from the docs — notably: vanilla API fields are camelCase, not the
  docs' PascalCase).
- `vanillaApiClient.ts` / `frmApiClient.ts` — low-level HTTP clients, one per API.
  Both take an injectable transport/fetch so they're testable without a real socket.
- `satisfactoryServerAdapter.ts` — `SatisfactoryServerAdapter`, the class
  `services/` should actually depend on. Maps raw → domain.
- `config.ts` — env-var config (host/ports/tokens); see `backend/.env.example`.
- `__fixtures__/rawFixtures.ts` — fixture data for tests, sourced from
  `docs-vault/raw-sources/captured-responses/` (real captures) where available,
  otherwise the docs' own example responses.

## Known gaps (see `docs-vault/wiki/data-gap-analysis.md`)

- `getFactory`/`getPower`/`getPowerUsage`/`getPlayer` mappings are schema-confirmed
  from docs but not yet validated against a save with real buildings/players — the
  Phase 2 spike's test save was empty.
- FRM's documented tunneled transport (through the vanilla API's port) 404s on this
  version; the adapter only implements FRM's direct Web Server.
- The `X-FRM-Authorization` header name is documented but not live-verified — the
  spike's server never enforced auth.
