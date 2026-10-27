# ADR-0059: Planner edges routed orthogonally by our own router on dagre (amends ADR-0050 Decision 3, ADR-0055 Decisions 7 and 8)

Status: **Accepted** (owner, 2026-10-26; see "Owner's answers"). First proposed the same day as "ELK in a worker"
(#711); the owner declined ELK's licence, kept the design and asked for "a different method to get somewhere close".
This ADR is that method, chosen on measurements of four engines.

## Context

The owner's screenshots of the planner canvas (2026-10-26) showed edges running under cards, long edges taking
V-shaped detours, labels on other lines or colliding with cards and text, and a factory card wearing a consumer's glyph.
PR #710 fixed what a renderer can fix on dagre's routes: curved edges, labels in dagre's reserved boxes, transport glyphs
inside their labels, the factory icon. Lines under cards and lines through labels come from dagre's routes themselves:
dagre places a long edge's waypoints in free slots within each rank, then joins them with straight segments that cut
across cards between ranks.

The owner chose the look on a prototype (`proto/elk-layout`, comparison page per scene): orthogonal routes, no ports
(an edge may touch a card on any side), rounded corners, only true return flows reversed, feedback edges drawn like any
other edge, labels clear of everything.

### Engines measured (`proto/elk-layout`, commits `a290a095` to `f34da839`)

Synthetic scenes, marked synthetic: a 40-card, 65-flow site; a 12-factory overview with 61 flows; the aluminium chain
(water returned to the first refinery) alone and inside the 40-card site. Plus the shared fixtures and the demo world.

| Dense 40-card site | Crossings | Edges through cards | Labels on other lines | Detours | Edge length | Layout | Ships |
|---|--:|--:|--:|--:|--:|--:|---|
| dagre today (after #710) | 125 | 33 | 55 | 17 | 43.5k | 17 ms | MIT, 16 KB gzip |
| **dagre + our orthogonal router** | 114 | **0** | **0** | 8 | 59.6k | 15 ms | MIT, +2.5 KB gzip |
| MSAGL, rectilinear, rounded | 67 | 1 | 15 | 1 | 36.1k | 344 ms | MIT, 184 KB gzip |
| ELK, orthogonal, depth-first, rounded | 61 | 0 | 0 | 2 | 37.5k | 84 ms | EPL-2.0 OR GPL-3.0, 430 KB gzip |

On the 12-factory overview: dagre today 198 crossings and 11 edges through cards; our router 134 and 0; MSAGL 141, with
69 label clashes; ELK 79 and 0. Inside the dense site with the aluminium loop: our router 142 crossings, 0 through cards,
0 label clashes; ELK 68, 0, 0. Every dagre variant and MSAGL reverse only the water return; ELK only with `DEPTH_FIRST`.

- **ELK** is the best picture but cannot ship: its licences are EPL-2.0 (incompatible with this AGPL-3.0-only repo) or
  GPL-3.0, which the owner declined because it would block a closed or dual-licensed frontend (ADR-0018).
- **MSAGL** (`@msagl/core`, MIT) nearly matches ELK's crossings on the site, but routes after placing labels, so labels
  land on other lines (15 to 69 per dense scene), an edge can cross a card, and a dense layout takes 330-440 ms.
- **dagre plus our router** matches ELK on the two faults the owner saw (nothing under cards, no label clashes) and keeps
  dagre's speed; it leaves crossings near today's and draws longer lines (lanes widen the gaps between columns).

## Decision

### 1. dagre places, our router draws

dagre keeps ranking, ordering, positions and label boxes (`frontend/src/planner/graph/layoutSite.ts`), with:

- loops broken by our own depth-first search before dagre (`returnFlows` in `layoutSite.ts`), not `"greedy"`. Amended in
  build PR 1 (2026-10-26): dagre's default depth-first search starts from the first card listed, so on a card list that
  begins inside a loop it reversed a forward flow and left the return pointing on; ours starts from the sources (cards no
  flow enters), as ELK's `DEPTH_FIRST` does, then from any card not yet reached. Dagre gets the returns reversed and no
  cycles; their routes are turned back round after layout;
- `ranker: "tight-tree"` (fewer crossings than `network-simplex` in the tuning runs: 423 to 394 summed over all scenes).

A new pure module, `frontend/src/planner/graph/orthogonalRoute.ts` (`routeOrthogonal`), turns dagre's routes into
orthogonal ones:

- between two consecutive points of a route in adjacent ranks: horizontal, then vertical in the gap between the ranks,
  then horizontal. No card stands in a gap, so no leg crosses one;
- each vertical leg gets its own track in its gap, the tracks of one gap ordered to add the fewest crossings, evenly
  spaced; a gap with more tracks than fit is widened;
- an edge leaves and enters a card on its left or right side at the card's height, several ends on one side spread
  evenly (no ports otherwise);
- a straightening pass keeps an edge at one height across columns where that height is free of cards, labels and other
  edges' levels.

### 2. Rounded corners

Every bend is a circular arc, radius 10 layout units, at most half the shorter adjacent segment
(`roundedOrthogonalPath`, beside the router). It replaces #710's B-spline (`edgeCurve.ts`).

### 3. Labels and glyphs stay as #710 drew them

Each label sits in the box dagre reserved for it, on its own line, on a surface pill; a transport's glyph stands in its
label. Feedback edges look like every other edge (owner).

### 4. Main thread, no new download

Routing adds about 1-3 ms to dagre's 6-19 ms on the dense scenes and 2.5 KB gzip to the planner chunk. ADR-0050's worker
trigger (a layout over 100 ms) is not reached; layout stays synchronous and memoised as today.

### 5. When layout fails

ADR-0050's last-resort grid stays for a dagre failure, now with a short notice that the layout is unavailable (owner,
answer B). If the router throws on a scene, that scene's edges are drawn on dagre's own routes with #710's curves, and
the failure is counted in the layout stats.

### 6. Contracts

None. `packages/shared` does not change.

## Build plan (each PR from `main`)

| # | PR | Files | Proof |
|---|---|---|---|
| 1 | Router and rounded corners | `orthogonalRoute.ts` and its tests (from the prototype), `layoutSite.ts` (depth-first acyclicer, `tight-tree`, router after dagre, router fallback), `SiteGraph.tsx` (rounded paths), `edgeCurve.ts` removed, `docs-vault/wiki/frontend-planner-map.md` | Unit tests: no leg through a card, tracks in a gap apart, ends on card sides, straightening, a router failure falling back; a metrics test on the synthetic dense scenes (no edge through a card, no label overlap, crossings no worse than measured); the aluminium scene reversing only the return; `test-hunter` |
| 2 | Baselines and review | regenerated planner screenshots; the grid's notice | `npm run baselines`, `ui-reviewer`; the owner checks the planner on their own save once live (answer a) |

## Consequences

- No line under a card and no label on another line, on every measured scene; rounded orthogonal lines throughout.
- Crossings stay close to today's, and lines are longer; dense sites read cleaner but not as compact as ELK's.
- No new dependency or licence; the router is our code to maintain.

## Revisit when

- The owner finds crossings on their real save worse to read than before, or a site's crossings grow past what the
  dense synthetic scene shows: then try card ordering of our own (extra crossing-reduction passes over dagre's order),
  or MSAGL's ordering under our router and labels (the prototype keeps both measurable).
- A layout takes over 100 ms: the worker step of ADR-0050 Decision 3.
- elkjs or another layered engine becomes available under a permissive licence.

## Owner's answers (2026-10-26)

1. Ship elkjs under GPL-3.0? **No.** Keep the approved design and reach it another way.
2. No dagre fallback, the grid plus a notice when layout fails? **Yes (B).**
3. How to check on a real save? **(a)** measure on the demo and the synthetic dense scenes, then the owner looks at
   their own planner once it is live.
