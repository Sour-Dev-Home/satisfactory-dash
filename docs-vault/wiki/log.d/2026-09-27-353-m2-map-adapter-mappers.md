- 2026-09-27 — game-adapter: ADR-0038 build card M2 (#353), the rails and resourceNodes mappers into
  the M1 contract. New raw schemas (`rawSchemas.ts`): `RawFrmTrainRailSchema`
  (docs-vault/raw-sources/captured-responses/frm-getTrainRails-2026-09-27-trimmed.json) and
  `RawFrmResourceNodeSchema` (…frm-getResourceNode-2026-09-27-trimmed.json, whose one endpoint
  returns both `NodeType: "Node"` and `"Fracking Satellite"`, architect's #352 follow-up). New
  `src/map/` module: `toWholeMetres` (game-unit centimetres to the contract's whole metres,
  world-coordinates.md), `mapRailSegment(s)` (drops `z`, rotation, `Connected0`/`1`, `Length` — the
  map only draws a line) and `mapResourceNode(s)` (`type` from FRM's `Name`; `purity` from FRM's own
  `Purity` field lowercased, never the typo'd `EnumPurity`; `nodeType` camelCased via a small lookup
  that passes an unrecognized future value through unchanged). Wired into
  `SatisfactoryServerAdapter.getRails()`/`getResourceNodes()`, alongside the existing `getPower`-style
  methods (validate via `parseUpstream`, then map). rawTypes.ts gained the two matching exported
  types, following its existing per-schema convention. Mapper tests read the real capture files
  directly and assert the output equals exactly what `packages/shared/fixtures/map.ts`'s
  `railsSample`/`resourceNodesSample` already claim, and that it passes the M1 schemas
  (`RailsLayerDataSchema`/`ResourceNodesLayerDataSchema`). No domain-layer type was introduced: unlike
  power/factory/players, nothing here needs a richer domain shape than the M1 contract itself. M3
  (backend routes) and M4 (agent reader) are separate PRs.
