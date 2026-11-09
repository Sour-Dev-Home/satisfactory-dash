- **ADR-0066 proposed: the mod is the only way a server connects.** Owner decisions, 2026-11-08: retire the Node edge agent and
  the Electron server manager, the owner's old Node-agent server, and direct-poll (`local`) servers with `packages/game-adapter`
  and `backend/src/modules/gameserver`. Kept: kind `agent`, `/agent/v1`, enrolment codes, pairing (mod 0.3.0 will pair),
  `agent_offline` and self-serve. `local` rows convert to `agent` in an expand-only data step; their sealed tokens are dropped
  later in an owner-gated contract migration. `SERVER_SECRETS_KEY` stays, because it also seals alert webhooks and push data.
  Ten ordered PRs. Status proposed: nothing is built until the owner accepts. Drafted by the architecture-advisor.
