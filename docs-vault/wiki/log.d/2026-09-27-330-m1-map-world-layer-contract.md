- 2026-09-27 — Shared: ADR-0038 build card M1 (#352, Refs #330), the map world-layer contract.
  Scope per #352's comment (after the #360 captures): `rails` and `resourceNodes` only, no geyser
  layer until `getResourceGeyser`'s empty capture is explained. New `packages/shared/src/map.ts`:
  `KNOWN_MAP_WORLD_LAYERS`; a shared `PolylineSchema` (#352 addition a — `[x, y]` whole-metre integer
  pairs, capped at `MAP_WORLD_MAX_POLYLINE_POINTS`), reused by `RailSegmentSchema`; `ResourceNodeSchema`
  (`{type, purity, x, y, exploited}`, `type`/`purity` as plain strings for deploy skew); a
  `worldLayerResponseSchema` generic wrapper (`envelope.ts`'s `snapshotEnvelope` pattern) giving
  `{layer, hash, observedAt, truncated, count, data}`; per-layer ingest request schemas (strict,
  no `layer`/`hash` in the body — the URL's `:layer` says which, ADR-0038 M3); `MAP_WORLD_LAYER_MAX_BYTES`
  (2 MB, #352 addition b — documented as measured on the serialized projected JSON by the sender and
  enforced again at ingest, a body-size guard for M3's route, not a schema `.refine()`). Also adds
  `mapLive` (`{trains, stations}`, from `getTrains`/`getTrainStation`) as an optional part of
  `agent.ts`'s `SnapshotRequestSchema`, folded into its existing "no parts when unreachable" refine.
  Fixtures (`packages/shared/fixtures/map.ts`) are projected from the #334-era captures
  (`frm-getTrainRails-2026-09-27-trimmed.json`, `frm-getResourceNode-2026-09-27-trimmed.json`,
  `frm-getTrains-2026-09-27-full.json`, `frm-getTrainStation-2026-09-27-full.json`), computed
  programmatically (divide by 100, round) rather than by hand. `test/map.test.ts` covers the caps,
  the deploy-skew plain-string fields, the generic wrapper, and `mapLive`'s refine interaction;
  `test/fixtures.test.ts`'s drift tripwire gained the new fixtures' schema mappings. Contract only
  (M2 mappers, M3 backend routes, M4 agent reader, M5/M6 frontend all come later, each its own PR);
  verified additive and backward compatible against the full backend and frontend suites (both
  green, no caller touched, per CLAUDE.md rule 6).
