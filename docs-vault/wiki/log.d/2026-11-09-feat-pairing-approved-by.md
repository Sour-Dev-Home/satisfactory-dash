- **Pairing poll: optional `approvedBy` (contract, additive).** The approved branch of `PairingPollResponseSchema`
  (`packages/shared/src/pairing.ts`) may carry `approvedBy`, the approving account's display name (1 to 64 characters, no
  control, bidi or zero-width characters), so the mod can log who approved (ADR-0051 section 1 point 4), as the mod session
  asked for its 0.3.0 pairing. The backend sends it only when the name is one identity generated (`Player-` and 4 or 8 of
  its alphabet); the operator's name, which comes from `.env`, and any other name never leave the backend
  (`shareableApprover` in `pairingService.ts`). The name is read in the poll's transaction (`findApproverName`). Tests: the
  schema bounds, the filter, the DB poll (a generated name included, others omitted) and the route.
