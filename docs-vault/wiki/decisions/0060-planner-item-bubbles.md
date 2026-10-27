# ADR-0060: Item-icon bubbles and focus mode on planner links (amends ADR-0050 and ADR-0059)

Status: **Proposed** (2026-10-27, #726). The owner accepts or amends it; until then nothing here is built. Decision
notes from an independent `architecture-advisor` review of the planner code on `main` after #732. Paths below are
relative to `frontend/src/planner/graph/` unless they say otherwise.

## Context

The owner asked (2026-10-27, #726) for each planner link to show what it carries as the item's **icon**, as a small
circular bubble on the line, and for that bubble to be interactive. A click, or Enter on keyboard focus, enters a focus
mode. In focus mode the bubble grows, everything unrelated dims, neighbouring cards move out of the way, and the bubble
morphs from a circle into a square detail card. Escape, a background click or a close control reverses it. With reduced
motion only the state changes.

What the code already has, and the design builds on:

- **Reserved label boxes.** dagre reserves a box for every edge label. `labelAt` takes that box's centre
  (`layoutSite.ts:393-399`), and the router forces each line through its own label point (`layoutSite.ts:439-444`). So a
  label always sits on a horizontal run with room kept clear of cards, lines and other labels (ADR-0059 Decision 3). The
  box size comes from `labelSize(lines)` (`layoutSite.ts:145`) plus `GLYPH_INSET` for transports (`layoutSite.ts:534-535`).
  It is the size passed to `g.setEdge` (`layoutSite.ts:362,368`) and hashed into the layout memo
  (`layoutSite.ts:263-266`).
- **Bundled links.** The 2026-10-27 amendment of ADR-0059 (#732) bundles the flows of a card pair into one line.
  `bundleFlows` (`canvasScene.ts:237-280`) gives one `CanvasFlow` per pair, with `parts[]` (`canvasScene.ts:124`). Each
  part carries `itemClassName`, `itemName`, `ratePerMinute`, `quality`, `rate` (measured, estimated or unknown), `carrier`
  and `routeName` (`canvasScene.ts:104-124`). One line can carry several items.
- **Dimming and motion.** These already exist:
  - the dim token `--opacity-graph-dim: 0.25` (`frontend/src/index.css:132`);
  - the dim props on `EdgeLine`, `EdgeLabel` and `CardView` (`SiteGraph.tsx:785-802, 917`);
  - the motion tokens `--ease-standard` and `--duration-fast/base/slow` (`index.css:160-164`), which reduced motion
    zeroes in one place (`index.css:432-442`);
  - `motionOn(motionPref, reduced)` (`SiteGraph.tsx:183-185`).
- **Accessibility layer.** The canvas `<svg>` is `role="img"`. Its real buttons live in an `sr-only` HTML layer in
  `tabOrder` (`SiteGraph.tsx:483, 668-692`), and Escape and focus return are at `SiteGraph.tsx:396-415`.
- **Building icons.** `buildingIcons.ts` maps FRM class to slug in a `Map`, and `buildingIcons.test.ts` checks that every
  slug has a file. `frontend/public/game-assets/NOTICE.md` records the art's terms and the rebuild command
  (`sharp-cli@6.1.0`, 64x64, quality 85).
- **CSP.** The policy is `style-src 'self'; img-src 'self'` (`frontend/public/_headers:6`). Local WebP and React's
  CSSOM style writes are fine.
- **Layout cost.** The dense 40-card scene lays out in 15-19 ms (ADR-0059). The measured 385-machine site (160 groups,
  204 edges, ADR-0055) has **no recorded layout time [NEEDS MEASUREMENT]**. ADR-0050 Decision 3 moves layout to a worker
  past 100 ms.

The owner has already exported 140 item icons (`IconDesc_*_256.png`) from the game with FModel. They live outside the
repository, on the owner's disk.

## Decisions

### 1. The bubble row replaces the label box

- **Position.** The bubbles sit where the label sits today: the row's centre is `labelAt`, already on a horizontal run.
- **Box size.** `labelSize(f.labelLines)` becomes a bubble-row size:
  - `n = min(distinct items, 3)` bubbles of diameter `BUBBLE_D` (24 layout units), 4 apart;
  - a "+k" chip (about 22 wide) when there are more than 3 items;
  - the short rate text under the row, which makes the box `BUBBLE_D + LABEL_LINE_H` high;
  - transports keep `GLYPH_INSET`, with the glyph at the row's left.
- **Which items.** The row shows the distinct `itemClassName`s across `parts`, ordered by summed rate (descending),
  then by name.
- **Text kept elsewhere.** The full label stays in the edge `<title>` and the Tables view.
- **No new collisions.** dagre reserves the box and the router already clears it. In the merged fallback (`stack`,
  `layoutSite.ts:359`) the row height simply replaces the label height.
- Rejected: placing bubbles after routing on the "longest horizontal leg". That is a second placement pass, which can
  land on tracks or other labels, the fault ADR-0059 removed.
- Rejected: one bubble per part, unlimited. An 8-item bundle would make a very wide box and push ranks apart.

### 2. Focus state and the dim rule: hop-1

- **What stays lit:** the focused link, its two cards, and the other bubbles on that link (the focused one marked).
- **Everything else** is drawn at `--opacity-graph-dim` through the existing `dim` props. No new token.
- **State.** `focus: { edgeKey, item } | null` in `SiteGraph`.
  - `edgeKey` is `from|to|carrier|kind`, not the edge index, so a poll that reorders edges keeps the focus.
  - If the key leaves the graph, focus clears.
- Rejected: dimming to the item's whole supply path (`reachFor`, `graphModel.ts:186-206`). That is already what the item
  filter does (`SiteGraph.tsx:244`), so two gestures would share one look with two meanings. On a big site it would also
  light every other link carrying that item.
- The detail card can offer **"Show this item's path"**, which sets the existing item filter, at no new cost.

### 3. Make room: re-layout with the focused box enlarged, animated

- **Layout.** `layoutScene` takes an optional `focus: { edgeKey, width, height }` and enlarges that edge's label box to
  the detail card's size (about 220 x 200 units).
  - dagre and the router already keep lines and cards clear of label boxes, so the graph makes room with no router
    change.
  - `focus` joins the memo signature. The focused layout is cached, and closing returns to the cached overview at no
    cost.
- **Transition.** One tween `t` from 0 to 1:
  - cards interpolate between their two positions;
  - lines cross-fade, old out and new in. Paths are not interpolated, because their point counts differ.
- **Stability.** dagre is not stable, so the new layout is translated (a viewport offset) until the focused bubble sits
  where it was on screen. What the user is looking at stays put, while other cards may shift; moving them is the point
  of making room.
- **Zoom.** If zoom is below a readable floor (about 0.6), the viewport also animates to centre the card, using the
  existing `viewport.ts` helpers. Whether to do this is open question 2.
- **Cost guard.**
  - PR 4 benchmarks the focused `layoutScene` on the 385-machine fixture and records the number here.
  - Past 100 ms (`stats.lastMs`, `layoutSite.ts:540-543`), focus degrades to dim plus a card overlaid on the bubble,
    with no make-room.
  - The worker step of ADR-0050 Decision 3 is pulled in only if that benchmark fails.
- Rejected: a local force push of neighbours. It is a second layout engine, it breaks ADR-0059's tracks (a re-route is
  needed anyway), and it lets lines cross cards.

### 4. The morph: one SVG rect, one JS tween, existing tokens

- **Shape.** One `<rect>` in one `<g>`, with no circle swap.
  - The tween `t` drives the rect's x, y, width, height and `rx`: `rx` goes from `D/2` (a circle) to the card radius,
    and the box from the bubble to the card.
  - The icon is an SVG `<image href>` that grows from bubble size to the card's top.
  - The detail text is `<tspan>` lines, fading in over `t` from 0.6 to 1. They are truncated with the existing
    character-width estimate, and the full text goes in `<title>`.
- **Driver.** A small `useTween` hook running one `requestAnimationFrame` loop.
  - It reads the duration from `--duration-slow` through `getComputedStyle`, as `--duration-glide` already is.
  - It uses the `--ease-standard` curve, mirrored in one JS constant with a test that keeps it equal to the CSS.
  - The same tween drives the card glide, the cross-fade and the morph, so reduced motion has a single path.
- **Reduced motion.** The duration token is 0 under reduced motion, and `motionOn` is checked too, so `t` jumps to its
  end. Only the state changes, as the owner asked.
- **Frame cost.** Per-frame updates write attributes through refs, not React state, and only for cards that move more
  than 1 unit. Target 16 ms a frame, measured in PR 4.
- **Content.** The detail card shows only `CanvasFlow` data:
  - item name, rate per minute with measured, estimated or unknown;
  - from and to, transport, route name;
  - the bundled parts.
- **Belt tier and capacity** are not on `CanvasFlow` today **[NEEDS VERIFICATION]**. They are shown only when present.
  Adding them is a separate `packages/shared` change (CLAUDE.md rule 6).
- No `foreignObject`: its rendering under the viewport transform is unreliable in Safari, and the content is a few
  fixed lines. There is no layout shift, since everything stays inside the fixed-size `<svg>`.
- Rejected: a CSS transition with a circle swapped for a rect. That needs two elements and flashes at the swap.

### 5. Keyboard and screen reader

- **Buttons.** Bubble buttons live in the existing `sr-only` HTML layer. The SVG is `role="img"`, so its children
  cannot be exposed.
- **Tab order.** Bubbles have one tab stop with a roving tabindex. Arrow keys move through bubbles in `tabOrder` order,
  so a site with 200 bubbles does not add 200 tab stops.
- **Labels.** Each button is labelled "<item>, <rate> per minute (measured / estimated / unknown), from A to B" and
  carries `aria-expanded`. Enter or Space focuses.
- **Leaving focus.** Escape gets a first branch ahead of the chain at `SiteGraph.tsx:405`: focus, then the panel, then
  the selection. Focus returns to the bubble's button. A background click also closes the card, and the card has a
  close button in the DOM layer.
- **Announcements.** The existing `role="status"` span announces "Focused <item> from A to B" and "Overview".
- **Pointer.** A pointer click on an SVG bubble calls the same handler, and the end of a drag is not a click (the
  existing `dragged` ref).
- **Text path.** It stays complete: the Tables view and `flowTitle` are unchanged.

### 6. Item icon pipeline

- **Script.** `scripts/dev/build-item-icons.mjs`, committed.
  - It takes the source directory as `--src <dir>`. The script and the docs refer only to "the owner's FModel export",
    and no local path is committed.
  - It runs the same `sharp-cli@6.1.0` as the buildings to write `frontend/public/game-assets/items/<slug>-32.webp` and
    `<slug>-64.webp` (quality 85).
  - The slug is the icon name in kebab case.
- **Notice.** `game-assets/NOTICE.md` covers `items/` with the buildings' terms and the new rebuild command.
- **Map.** `itemIcons.ts` holds a `Map<string, string>` keyed by the item class name (`Desc_X_C`, which is what
  `CanvasFlow.itemClassName` carries; `IconDesc_X_256` maps to `Desc_X_C`). It exports `itemIconUrl(className, 32 | 64)`,
  which returns `undefined` on a miss.
- **Test** (`itemIcons.test.ts`, modelled on `buildingIcons.test.ts`):
  - every slug has both files;
  - every file is mapped;
  - the item classes in the captured responses under `docs-vault/raw-sources/` resolve;
  - a miss gives the text fallback.
- **Missing icon.** The bubble shows the item name's initials on a neutral disc, or "?" with no name, and is never
  blank. An unknown item's card says "Item unknown" and never invents a name.
- **Weight.** About 0.3-0.5 MB of WebP in `public/`, loaded on demand and not in the JS bundle.

### 7. Performance budget

| What | Budget |
|---|---|
| Bubbles on the 385-machine site | at most ~600 `<image>` (204 edges or fewer, 3 each); typically under 250 |
| Level of detail | below zoom 0.4: plain discs, no image or rate text |
| Overview layout | today's cost; the box size changes, not the algorithm |
| Focused layout | under 100 ms on the 385-machine fixture, else degrade (Decision 3) |
| Transition frame | 16 ms, attribute writes through refs |
| JS bundle | about +1 KB gzip (`itemIcons.ts`, tween hook, bubble components) |

### 8. Contracts

None. `packages/shared` does not change. Everything shown is already in `CanvasFlow` and its `parts`.

## Build plan (each PR from `main`, no stacking)

| # | PR | Files | Proof |
|---|---|---|---|
| 1 | Item icons | `scripts/dev/build-item-icons.mjs`, `frontend/public/game-assets/items/*`, `game-assets/NOTICE.md`, `itemIcons.ts`, `itemIcons.test.ts` | Every slug has both files, no orphans, captured classes resolve |
| 2 | Bubbles on lines, no interaction | `layoutSite.ts` (bubble-row box), `SiteGraph.tsx` (`EdgeLabel` draws bubbles, level of detail, fallback), `layoutSite.test.ts`, `layoutRouting.hunt.test.ts`, `SiteGraph.test.tsx`, `docs-vault/wiki/frontend-planner-map.md` | No overlaps with bubble boxes; baselines regenerated; `ui-reviewer`, `test-hunter` |
| 3 | Focus, no make-room | `SiteGraph.tsx` (focus state, hop-1 dim, `sr-only` bubble buttons with roving tabindex, Escape, live region), `plannerPrefs.ts` (feature flag) | Keyboard flow, axe, focus return |
| 4 | Make room | `layoutSite.ts` (`layoutScene({ focus })`, memo), `useTween.ts`, `viewport.ts` (compensation), the over-100 ms degrade | 385-machine focused-layout benchmark recorded here; stability of the focused bubble; memo hit on close |
| 5 | Morph and detail card | `SiteGraph.tsx` (rect morph, card content from `parts`, close control), easing constant test | End state; `t` jumps when the duration token is 0 |
| 6 | Demo and review | demo data, e2e (keyboard path, CSP, axe, no layout shift during the morph), screenshots | `ui-reviewer`; the owner reviews the demo, then the flag is removed |

## Consequences

- Links read at a glance by icon, and the full text path is unchanged for screen readers and the Tables view.
- Focus reuses the dagre and router machinery, so a focused card never sits on a line or a card. The cost is one extra
  cached layout per focus.
- Cards other than the focused one may jump during make-room, because dagre is not stable. Only the focused bubble is
  held still.
- 140 more game-art files ship under the existing NOTICE terms, and they are removed on request like the buildings.
- A new `useTween` hook and JS easing constant must track the CSS tokens. A test enforces that.

## Revisit when

- The focused layout on the 385-machine site exceeds 100 ms. Then use the degrade or ADR-0050's worker step.
- Unrelated cards jumping in make-room reads worse than an overlay card on the owner's save. Then use the overlay
  (Decision 3's degrade) by default.
- Belt tier and capacity reach `CanvasFlow`. Then the card shows them.
- Bundles of more than 3 items turn out common. Then revisit the limit or the "+k" chip's behaviour.

## Open questions for the owner

1. Dim to hop-1 (this link and its two cards), or to the item's whole path? Recommended: hop-1, with the path as a
   button on the card.
2. Should focus also zoom so the card is readable on a big site?
3. Should a "?" bubble (unknown item) be focusable? Recommended: yes, with a card saying "Item unknown" and the raw class
   name if there is one.
4. Is a 64 px image enough for the card, or add a 128 px WebP for the card only (about +0.4 MB)?
5. Is the limit of 3 bubbles per line right?
6. Keep the interaction behind a feature flag until your review? (Default: yes.)
