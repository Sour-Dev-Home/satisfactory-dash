# telemetry module

Status, factory and power for one game server (ADR-0014), as `services/` plus the
`routes/` that expose them. Its data is the mod's snapshots, handed in by the agents
module; it uses the servers module for `:serverId` scoping, and is consumed by the composition root
(`server.ts`) through `index.ts`. Business logic: production-rate math, overflow
detection, power-outage detection, alerting thresholds. Deterministic code (scheduled
poll + comparison), not LLM calls — see ground rule 3 in the root `CLAUDE.md`. Should be
testable without a live game server by feeding in domain-shaped fixture data.

- `index.ts` — the public API: `createTelemetryServices(ports)` and
  `createTelemetryRouters(directory)`.
- `serverStatusService.ts` — merges `ServerHealth` + `ServerStatus` into one response.
- `domain.ts` — telemetry's own `FactoryBuilding`, `PowerCircuit`, `BuildingPowerUsage` and
  `InventorySlot` (ADR-0066 Decision 5), moved here from the game-adapter package that build PR 7 removed.
- `factoryStates.ts` — the pure helpers the agent and polled paths share: `isBackedUp` (the
  overflow proxy — see `docs-vault/wiki/frm-api.md`, no direct "belt full" field
  exists in either API), `areInputsFull`, `sumItemRates` and `diffDecidedStates`.
- `productionService.ts` — maps `FactoryBuilding[]` to the factory overview.
- `powerService.ts` — maps `PowerCircuit[]`, classifies each as `ok`/`at_risk`/
  `outage` via a fixed threshold (`classifyPowerCircuit`). The `at_risk` battery-%
  threshold is our own choice, not sourced from docs-vault — see the comment at its
  definition.
- `itemForms.ts` / `itemForms.generated.json` / `parseGameDocs.ts` — the item-form
  catalog (ADR-0015): each item's className -> solid or fluid, from the game's own data,
  which sets `ProductionRate.unit` (`items/min` for solids, `m3/min` for liquids and
  gases; null for an item not in the catalog, logged once per className per process).

## Updating the item-form catalog

After a game update that adds items, regenerate the catalog and commit the diff (CI can't
reach the game files). It reads the game's `CommunityResources/Docs/en-US.json` (in the
install folder, UTF-16) and commits only class names and forms, never that file:

```
npm run update-item-forms -w backend -- "<install>/CommunityResources/Docs/en-US.json"
```

- On Windows, `npm run` mangles a path that contains spaces (for example
  `Program Files (x86)`). Set the path in the `ITEM_DOCS_PATH` environment variable
  instead and run `npm run update-item-forms -w backend` with no argument.
- The game version is read from the install's `*.version` file; pass `--game-version X`
  if it can't be found.
- The script fails, rather than writing a wrong catalog, if the file isn't the expected
  shape, is truncated, or gives one className two different forms.

Tests construct plain domain-shaped fixture objects (`backend/test-support/`) — no live
game server, no network mocking required.
