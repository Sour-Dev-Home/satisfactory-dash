# services

Business logic that consumes `adapters/` and is consumed by `routes/`: production-rate
math, overflow detection, power-outage detection, alerting thresholds. Deterministic
code (scheduled poll + comparison), not LLM calls — see ground rule 3 in the root
`CLAUDE.md`. Should be testable without a live game server by feeding in fixture data
shaped like an adapter's output.
