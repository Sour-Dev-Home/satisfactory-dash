# services

Business logic that consumes `adapters/` and is consumed by `routes/`: production-rate
math, overflow detection, power-outage detection, alerting thresholds. Deterministic
code (scheduled poll + comparison), not LLM calls — see ground rule 3 in the root
`CLAUDE.md`. Should be testable without a live game server by feeding in fixture data
shaped like an adapter's output.

- `serverStatusService.ts` — merges `ServerHealth` + `ServerStatus` into one response.
- `productionService.ts` — maps `FactoryBuilding[]`, computes `isBackedUp` (the
  overflow proxy — see `docs-vault/wiki/frm-api.md`, no direct "belt full" field
  exists in either API).
- `powerService.ts` — maps `PowerCircuit[]`, classifies each as `ok`/`at_risk`/
  `outage` via a fixed threshold (`classifyPowerCircuit`). The `at_risk` battery-%
  threshold is our own choice, not sourced from docs-vault — see the comment at its
  definition.

Each service takes a narrow `*AdapterLike` interface (structurally satisfied by
`SatisfactoryServerAdapter`) so tests construct plain fixture objects instead of a
real adapter — no live game server, no network mocking required.
