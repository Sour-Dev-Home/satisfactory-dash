- **Pairing accepts the mod's version string (contract, `packages/shared/src/pairing.ts`).** `PairingStartRequestSchema.agentVersion`
  allowed only `[0-9A-Za-z.+-]`, so the mod's `mod/0.x.y` (the string it already sends to enrol and in every snapshot, whose
  `AgentVersionSchema` has no character rule) would have been refused with 400 at `POST /agent/v1/pairings`. It now allows `/`
  too. Widening only: every string that passed still passes (the Node agent's `0.1.0` among them), no caller changes. Found by
  the mod session while designing the mod's device-code pairing (ADR-0051 section 1).
