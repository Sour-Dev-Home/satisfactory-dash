# Proposed body for issue #349

Drafted by the architect from ADR-0048 (proposed). Replaces the issue's body once the owner approves the ADR.

---

## Goal

When a machine is underfed or backed up, tell the owner why, from data the dashboard already has: nothing makes the
input, not enough of it is made, the machine making it is unpowered, paused or short itself, or enough is made but it
isn't arriving (a transport problem the data can't locate yet). Deterministic, no LLM (ground rule 3). Design:
`docs-vault/wiki/decisions/0048-bottleneck-finder.md`.

## Acceptance criteria

- [ ] `GET /api/servers/:serverId/bottlenecks?limit=N` (N 1 to 50, default 10) returns the top-N underfed and backed-up
      machines, each with a root-cause verdict, a chain of at most 8 steps and one sentence of text.
- [ ] Verdicts: `noProducer`, `deficit`, `upstream` (ending in `unpowered`, `paused`, `idle` or another verdict),
      `logistics`, `loop`; downstream: `noConsumer`, `surplus`, `downstream`, `logistics`.
- [ ] Every ingredient of an underfed machine is checked, not only the classifier's `missingInput` (FRM reports one
      `ConsPercent` for all ingredients, ADR-0048 Context).
- [ ] Same snapshot in, same findings out: ties broken by item `className`, then building `id`.
- [ ] Cycles terminate (a `loop` step), proven by a test.
- [ ] A generated 3,380-building factory (10x the owner's save) is analysed inside a fixed time bound in a test.
- [ ] Response stays under 15 KB at N 25 (a test on the generated factory).
- [ ] The UI shows a top-N list and a "why" line on an underfed or backed-up machine; `logistics` text says the belt or
      pipe can't be identified yet; demand from generators, storage and the sink is described as not visible.
- [ ] No new FRM read, no agent snapshot change, no database table.

## Interface contract

New, additive, in its own PR first: `packages/shared/src/bottlenecks.ts` (`BottleneckStepSchema`, `BottleneckSchema`,
`BottlenecksSchema`) and `endpoints.bottlenecks`, response wrapped in `snapshotEnvelope`. Sketch in ADR-0048.

## Scope

In: the item-level graph and walk over the latest factory snapshot (`backend/src/modules/telemetry/`), the route, the
frontend list and "why" line.

Out (follow-ups, each needing the owner's go): extractor rates via `getExtractor` (needs a capture first), per-ingredient
input-buffer fill in the contract, and belt or pipe level root cause (needs a mod claim: FRM has no connection
identities, port positions, splitters or mergers).

## Blocked by

The owner's approval of ADR-0048. Nothing else: the data is already in the snapshot.

## Tier

Backend: four PRs in order (contract, service, route, frontend), each small. Service needs `test-hunter`; frontend
needs `ui-reviewer`.
