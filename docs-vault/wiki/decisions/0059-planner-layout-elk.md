# ADR-0059: Planner layout with ELK in a worker (amends ADR-0050 Decision 3, ADR-0055 Decisions 7 and 8)

Status: **Proposed** (2026-10-26). Written from a measured prototype and an architecture review. The owner has chosen
the look (rounded corners, no ports, feedback edges in the normal style) and said the download "seems manageable";
the licence question at the end is still theirs.

## Context

The owner's screenshots of the planner canvas (2026-10-26) showed edges crossing and running under cards, long edges
taking V-shaped detours, and edge labels colliding with cards and other text or sitting on other lines. PR #710 fixed
what dagre can fix (curved edges, labels in dagre's reserved boxes, transport glyphs inside their labels). The rest
comes from dagre itself: it routes edges without regard to cards and places rank-skipping waypoints wherever crossing
reduction puts them.

ADR-0050 Decision 3 chose dagre and rejected `elkjs` for two reasons only: size ("27 times dagre's gzip size") and "a
licence question for an AGPL-3.0-only repo" (`0050-production-planner.md:120`). It already planned the seam this ADR
uses: layout behind one async function, moved into a same-origin module worker when needed (`:130-133`).

| Fact | Evidence |
|---|---|
| A prototype lays out the planner's scenes with ELK beside dagre, same `SiteLayout` shape, measured per scene. | Branch `proto/elk-layout` (`a290a095`, `e4c17029`, `992bbdf3`): `frontend/src/planner/graph/layoutElk.ts`, `edgeShapes.ts`, `layoutElk.proto.test.ts` |
| On a 40-card, 65-flow site: dagre 125 crossings, 33 edges through cards, 22 label overlaps; ELK (orthogonal, no ports, straightened, rounded) 76, 0, 0. | Prototype metrics (synthetic scene `dense40-site0`, marked synthetic) |
| With the aluminium feedback loop (water returned to the first refinery) inside that site: dagre 125 crossings, 26 edges through cards, 99 label problems; ELK with `DEPTH_FIRST` cycle breaking 68, 0, 0, and only the water return reversed, 44 units longer than a straight line. `GREEDY` reversed the forward alumina flow; `MODEL_ORDER` also reversed an unrelated flow; `feedbackEdges` on added 221-761 units of detour. | Prototype scenes `aluminium-loop`, `aluminium-in-dense40` |
| ELK's costs: about 2.3 times the bends (orthogonal routes), 18% more area unstraightened, about a third less edge length once straightened; compute 25-80 ms per dense scene against dagre's 6-19 ms (Node, jsdom). | Prototype metrics |
| Size: `elk.bundled.js` 1,426 kB / 430 kB gzip; `elk-worker.min.js` 1,558 kB / 454 kB gzip; `elk-api.js` 5 kB / 2 kB. The `SiteGraph` chunk is 32 kB gzip today against a 100 kB budget. | Prototype `bundle/`; `frontend/e2e/build-output.spec.ts:91,107,134` |
| No `eval` or `new Function` in either ELK file; layout ran with code generation from strings disabled. A same-origin worker passes today's CSP (no `worker-src`, so `script-src 'self'` applies); a `blob:` worker would not. | Prototype; `frontend/public/_headers` |
| Layout today is synchronous: `layoutScene` in a `useMemo`, memoised by `topologyHash` plus a signature of cards, flows and sizes, so a poll that moves only rates reuses the placement. | `frontend/src/planner/graph/SiteGraph.tsx:192`; `layoutSite.ts:227,391-421` |
| ADR-0018 asks for AGPL-compatible dependencies and lists only permissive ones; LEGAL.md covers GPL only for FRM and SML as separate programs. Nothing yet says whether a GPL npm dependency may ship in the frontend. | `0018-license-agpl.md:28`; `LEGAL.md:35-50,75-121` |

## Decision

### 1. ELK layered replaces dagre for every planner canvas

`elkjs` (pinned, exact version), algorithm `layered`, direction `RIGHT`:

| Option | Value | Why |
|---|---|---|
| `elk.edgeRouting` | `ORTHOGONAL` | The only routing that took edges through cards to zero; splines brought detours back |
| Port constraints | none (`noports`) | Owner's choice: shorter lines; an edge may touch a card on any side |
| `elk.layered.cycleBreaking.strategy` | `DEPTH_FIRST` | The only strategy that reversed just the true return flow in both loop scenes |
| `elk.layered.feedbackEdges` | `false` | Routing returns round the outside cost 221-761 units of detour |
| `elk.layered.nodePlacement.strategy` | `NETWORK_SIMPLEX` | Fewest bends of the placements tried (434 against 446) |
| `elk.layered.considerModelOrder.strategy` | `NODES_AND_EDGES` | Fewer crossings (173 against 203) and a stable picture between polls |
| `elk.layered.mergeEdges` | `false` | On, it doubled crossings between unrelated flows |
| `elk.edgeLabels.placement` | `CENTER`, labels as layout elements | Zero label collisions in every scene |

Feedback edges are drawn like every other edge (owner, 2026-10-26).

### 2. Rounded corners, drawn by the renderer

Every orthogonal bend is drawn as a circular arc (radius 10 layout units, at most half the shorter adjacent segment),
a pure function `roundedOrthogonalPath` beside the other drawing helpers. Labels stay on their line on a pill, and a
transport's glyph stays in its label (PR #710). PR #710's B-spline (`edgeCurve.ts`) is retired with dagre.

### 3. In a same-origin worker, loaded only by the planner

ELK runs in `elk-worker` served from our own origin with a hashed name, requested only when a planner canvas first lays
out. The reason is weight, not time: 25-80 ms is under ADR-0050's 100 ms trigger, but 450 kB of layout code belongs
neither in the planner chunk nor on the main thread. `SiteGraph`'s chunk grows by the 2 kB `elk-api`. No CSP change.

### 4. An async layout with a synchronous memo hit

- The memo stays as it is (topology plus signature; text never in the key). A hit returns at once, so a rate-only poll
  never waits and the first render after a hit has its layout.
- A miss starts one worker call per key. A request counter drops results for a scene that is no longer current. The
  previous layout stays on screen while the new one is pending: no blank frame, no viewport reset.
- The viewport, focus and reveal effects (`SiteGraph.tsx:213-302`) follow the arrival of a layout, not the mount.
- The canvas carries `data-layout="ready"` once laid out; e2e tests wait on it.
- A small `LayoutEngine` seam: the worker in production; `elk.bundled` with elkjs's in-process fake worker in Vitest
  (jsdom has no `Worker`).

### 5. No dagre fallback

If the worker cannot load or a layout throws, the canvas uses the existing last-resort grid (`layoutSite.ts`
`placeGrid`) and says the layout is unavailable, with a retry. Two engines would double the upkeep and keep dagre's bytes.
The Tables view and the text form (ADR-0050) carry the same facts either way.

### 6. Budgets

- The `SiteGraph` chunk stays under 100 kB gzip and must not contain ELK's layout code.
- The worker is its own asset with its own budget: 470 kB gzip, about 4% over today's measurement.
- Neither appears in the entry chunk or the HTML. `build-output.spec.ts`'s dagre checks (`:91,107,134`) become these.

### 7. Licence (owner's decision, before the swap ships)

elkjs is `EPL-2.0 OR GPL-3.0-or-later`. EPL-2.0 alone does not combine with AGPL; the proposal takes the
**GPL-3.0-or-later** option, which GPL-3.0 §13 and AGPL-3.0 §13 let combine with this AGPL-3.0-only work. This reading is
not yet stated for npm code in the repo, so it goes to the owner (and to counsel, as ADR-0018 already does for
authorship). It narrows one option ADR-0018 keeps open: a closed relicence of the frontend bundle would need ELK out.
If accepted: a `THIRD-PARTY-NOTICES.md` entry (elkjs and Eclipse ELK, the dual licence, the option chosen), the licence
text served beside the worker as `OFL.txt` is beside the fonts, the worker's licence header kept by the build, a line in
`LEGAL.md`, ADR-0018's dependencies bullet amended, and an allowlisted exception in any licence check.

### 8. Contracts

None. `packages/shared` does not change; layout is inside the frontend.

## Build plan (each PR from `main`, not stacked; #710 merges first)

| # | PR | Files | Proof |
|---|---|---|---|
| 1 | Licence and docs | this ADR, `LEGAL.md`, ADR-0018's dependencies bullet, `THIRD-PARTY-NOTICES.md` | Owner's answer to Q1; docs gates |
| 2 | Async seam, still dagre | `layoutSite.ts` (engine seam, memo hit synchronous, promise on a miss), `SiteGraph.tsx` (hook, pending, stale drop, effects on arrival, `data-layout`), tests to `await`, e2e waits | Baselines unchanged; tests for a stale result dropped and a rate-only poll staying synchronous; `test-hunter` |
| 3 | ELK in the worker | `layoutElk.ts` and `edgeShapes.ts` from the prototype, the worker setup, `package.json` and lockfile, the licence file in `public/`, `build-output.spec.ts`, `frontend/CLAUDE.md` (the "dagre imported nowhere else" rule), `docs-vault/wiki/frontend-planner-map.md`, ADR-0050 and ADR-0055 layout mentions | The prototype's metric test kept as a regression guard (crossings, edges through cards, label overlaps no worse than measured); a blocked-worker e2e showing the grid and the notice; the CSP gate with the worker loaded; new baselines; `ui-reviewer`. **Gate:** measured on the owner's real save and the demo's largest site, in a built chunk, with browser timings |
| 4 | Remove dagre | `@dagrejs/dagre` from `package.json` and the lockfile, `edgeCurve.ts`, docs | Build output has no dagre; may fold into 3 |

## Consequences

- Fewer crossings, no edges under cards and no label collisions on dense sites, at the cost of more bends and a
  first-open download of about 450 kB, cached afterwards.
- The planner's picture appears a moment later on a cache miss (worker start plus layout); the previous picture stays
  while it does.
- A GPL-3.0 component ships in the frontend, if the owner accepts Decision 7.
- One layout engine; dagre and its spline renderer go.

## Revisit when

- First layout on the owner's real save takes over about 1 s on a throttled connection, or a site's layout over 100 ms
  in the worker.
- A site exceeds about 150 nodes, or the owner or `ui-reviewer` finds dense sites harder to read than before.
- elkjs changes licence or stops being maintained, or the CSP gains a `worker-src`.
- A closed or dual relicence of the frontend is pursued (ADR-0018): ELK would have to come out.

## Questions for the owner

1. Ship elkjs under its GPL-3.0-or-later option in this AGPL-3.0-only frontend (Decision 7)?
2. No dagre fallback: the grid plus a "layout unavailable" notice when the worker fails (Decision 5). Agreed?
3. The gate for PR 3 needs your real save: may the measuring run read it the way the planner does (read-only, the
   production graph response), or should it use a captured response you provide?
