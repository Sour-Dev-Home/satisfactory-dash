# ADR-0065: A guided first-time tour of the demo (demo build only)

Status: **Accepted** (owner, 2026-11-06; see "Owner's answers" below: the popover is attached with an arrow). The owner asked for "a walkthrough/first time user explanation of each part and how to
navigate (like how many sites do with a popup, dimming, and blurring for emphasis) ... doable in the demo so a hiring
manager without experience with satisfactory can get a gist of the tool and all the functionality". Owner answers,
2026-11-06 (each the recommended option): demo only; starts automatically on the first visit, with Skip, and a banner
button restarts it; one tour across all tabs; mostly Next/Back with a few try-it steps. Designed by an independent
`architecture-advisor` review of the code. No backend or contract change. Paths are relative to `frontend/src/` unless
they say otherwise.

## Context

- The demo (ADR-0026) is a separate build of the same app over a made-up world (`demo/world.ts`), with no network. Its
  `/` is "Enter demo"; inside the app `DemoBanner` is mounted `IS_DEMO &&` outside the auth gates (`App.tsx:39`).
  `IS_DEMO` is a build-time constant (`demo/mode.ts:6`), and `e2e/build-output.spec.ts:46-51` fails if demo strings reach
  the production bundle.
- A visitor who has never played Satisfactory sees six tabs of factory data with no explanation.
- The CSP is `style-src 'self'` (`public/_headers:8`) and the repo forbids `style=`; the e2e suite asserts `[style]` count
  0 on the planner's layers (`e2e/planner-graph.spec.ts:211, 339, 398, 583`). The common tour libraries (driver.js,
  Shepherd, react-joyride, Intro.js) position their popover and spotlight with inline styles (from their documentation,
  not re-verified against current versions).
- The planner already places HTML over a canvas by SVG attributes (`<foreignObject>`, `planner/graph/CanvasOverlay.tsx:45`).
- A page is revealed once its queries answer: `ui/PageReveal.tsx:41-46` sets `data-page-reveal="waiting|revealed"`.
- The planner keeps what is open in the URL (`OPEN_PARAM`, `planner/PlannerView.tsx:42-56`); its group panel opens on a
  card's click and closes on Escape (`planner/graph/GroupPanel.tsx:62`).

## Decisions

### 1. Built in-house, no tour library

Every common library positions with inline styles, which the CSP, the `[style]` guards and the token rule all reject;
patching that out leaves little of the library. The tour is ours, in `demo/tour/`.

### 2. Rendering: a clipped scrim, a ring, a docked popover

- **One overlay layer**, `fixed` in a portal on `document.body`, at a new `--z-tour` above `--z-popover` (`index.css:202`).
- **Dim and blur with a hole.** A full-viewport element with token classes for the scrim colour and backdrop blur, and an
  `index.css` rule `.tour-scrim { clip-path: url(#tour-hole) }`. A zero-size inline `<svg>` holds
  `<clipPath id="tour-hole"><path clip-rule="evenodd" d="..."/></clipPath>`: the viewport rectangle plus a rounded
  rectangle at the target. Only the path's `d` attribute changes, as the planner moves things by attributes.
- **The hole is real.** The clip cuts the hole from the dimming, the blur and hit-testing alike, so the target stays live:
  a try-it step's click lands on the real element with its real handlers. A click anywhere else lands on the scrim and
  does nothing.
- **Ring:** a 2 px `accent` SVG `<rect>` round the hole, placed by attributes.
- **Popover, attached with an arrow** (owner's answer 3): from `sm` up, the HTML panel sits in an SVG `<foreignObject>`
  in the overlay's full-viewport `<svg>`, placed by its `x`, `y`, `width` and `height` attributes, as
  `CanvasOverlay.tsx:45` places the planner's panel. Its width is a token; its height is measured from its content (a
  `ResizeObserver` on the inner panel) and written to the attribute. A pure `placePopover(target, size, viewport)` picks
  the first side with room, in the order below, above, right, left, keeps it inside the viewport with a margin, and
  falls back to centred when none fits. An SVG `<path>` arrow (accent, placed by attributes) points from the panel's edge
  at the target's nearest side. Below `sm` it is a bottom sheet with no arrow (at most about 40% of the height), moving to
  the top when the target is in the bottom 40%: a phone has no room beside the target.
- **Unverified, so build PR 1 starts with it:** `clip-path: url(#...)` together with `backdrop-filter` on an HTML element in
  Chromium, WebKit and Firefox. If a browser drops the blur, an `@supports` guard falls back to dimming only; the hole and
  everything else still work, and no step depends on the blur.

### 3. Steps and controller

- `demo/tour/steps.ts`: a typed list `{ id, path, search?, target, title, body, kind: "next" | "try", done?, doForMe? }`.
- A reducer holds `{ index, phase: "waiting" | "showing" | "fallback" }`.
- `demo/tour/tourStore.ts`, read with `useSyncExternalStore`, exposes `start()` and whether a tour runs, so the banner's
  button (in the eager bundle) can start a tour whose host is a lazy chunk.

### 4. Moving between tabs and waiting for the page

- Each step navigates to its `path` and `search`, then waits (a `MutationObserver` and animation frames) until its target
  exists, sits inside `[data-page-reveal="revealed"]` (or no reveal wrapper), and has a non-empty box. It scrolls the
  target into view (`block: "center"`, never smooth) and keeps the hole on it each frame while the step shows, since a
  page can fade in and the planner's canvas can pan.
- After `TOUR_TARGET_WAIT_MS` (6000, a named constant) the step shows centred with no hole, in words that stand alone;
  Back and Next still work. A missing target never stops the tour. Lazy chunks (planner, map) are covered by the same wait.

### 5. Targets: `data-tour`, compiled out of production

`demo/tour/target.ts` exports `tour(id)`, returning `IS_DEMO ? { "data-tour": id } : {}`, spread on the element
(`<section {...tour("overview-health")}>`). The production build drops it as dead code. `build-output.spec.ts`'s demo
markers gain `data-tour` and the tour's own words, so a leak fails CI. Never CSS classes or visible text as targets.

### 6. Try-it steps: observe, never reach into a page

- A step says how it is done by what appears or changes, not by reading the page's state:
  `done: { appears: "planner-group-panel" }` (an element with that `data-tour` appears) or
  `{ changes: "map-layer-toggle" }` (a `change` event on the target). The planner adds one attribute to its panel's root.
- While it waits the popover says what to do ("Try it: click the highlighted card"). Next stays enabled, so nobody is
  stuck.
- **Do it for me** dispatches a bubbling click on the target (`new MouseEvent("click", { bubbles: true })`, since an SVG
  card has no `.click()`), through the same handlers as a real click.
- If nothing registers within the wait, the step goes on as a Next step.

### 7. Remembering the first visit

- `demo.tour` = `"seen"` in localStorage, read and written with `plannerPrefs.ts`'s try/catch shape (`:19-32`).
- Written when the tour starts, so a reload half-way does not start it again.
- With storage blocked, a module-level flag stops a second start within one page load; across visits it may show
  again. That is accepted.
- It starts automatically only at exactly `/app` (the Overview), once the host mounts.
- The demo e2e tests and `npm run demo:video` set the key first (`addInitScript`), or the overlay would cover them.

### 8. Mounting and isolation

- `Shell.tsx` mounts `{IS_DEMO && <Suspense fallback={null}><LazyTourHost /></Suspense>}`, the host
  `lazy(() => import("../demo/tour/TourHost"))`. The production build removes the branch and the chunk.
- `DemoBanner` gains "Take the tour", shown under `/app` only.

### 9. Accessibility

- The popover is `role="dialog"` with `aria-labelledby` and `aria-describedby`, without `aria-modal` (the page must stay
  usable for try-it). A visually hidden polite live region says "Step 3 of 15: <title>".
- Focus moves to the popover's heading on each step and returns, on leaving, to where it was (or the banner's button).
  Tab and Shift+Tab wrap through the popover's buttons, and on a try-it step the target as well.
- Escape leaves the tour when focus is in the popover. The planner panel's own Escape (`GroupPanel.tsx:62`) is
  unchanged.
- Known limit: a screen reader's browse mode can still read the page behind the scrim.
- Every state is said in words, never by colour alone. Contrast and focus rings use existing tokens.

### 10. Motion

The hole jumps between targets with no transition. A step's fade-in, if any, uses an existing token animation that is
off under reduced motion.

### 11. Phones (390 px)

- The bottom sheet, with touch-size buttons and an 8 px pad round the hole.
- Each tab-bar target is scrolled into view, since the tab bar can scroll.
- Nothing needs hover.

### 12. Tokens

New in `@theme`: `--z-tour`, `--color-scrim`, `--blur-tour`, `--spacing-tour-pad`. Nothing raw.

## The steps

Names are the demo world's (`demo/world.ts:833-843, 954-959, 1239-1244`). Targets on Overview, Power, Factory and
Settings are proposals: build PR 2 places them on the real markup.

| # | Page | Target | Title and words | Kind |
|---|---|---|---|---|
| 1 | Overview | `overview-health` | **Welcome to the demo.** This is a made-up factory from Satisfactory, a game about building factories. This tool watches a factory from outside the game. Nothing here is live. | Next |
| 2 | Overview | `overview-health` | **Is everything OK?** One glance says whether power, machines and the server are healthy, without opening the game. | Next |
| 3 | Overview | `overview-alerts` | **Problems come first.** Anything that needs attention, such as a stalled machine or a power dip, shows up here. | Next |
| 4 | Power | `power-chart` | **Power over time.** Factories run on electricity, and running out stops everything. This shows use against capacity, so a shortage is seen coming. | Next |
| 5 | Power | `power-circuits` | **Circuits.** A circuit is a connected set of generators and machines; each shows its load, so the strained one stands out. | Next |
| 6 | Factory | `factory-machines` | **Every machine at a glance.** A machine stops when it lacks inputs or its output is full; each group says which, in plain words. | Next |
| 7 | Factory | `factory-bottlenecks` | **What holds production back.** The tool works out which machines limit the rest and says so in a sentence. | Next |
| 8 | Planner | `planner-canvas` | **A map of the production.** Each box is a group of machines; lines show what feeds what, with the item's name at each end. | Next |
| 9 | Planner | `planner-group-card` | **Open a group.** Click the highlighted card to see its machines and rates. | Try-it (`appears: planner-group-panel`; Do it for me clicks it) |
| 10 | Planner | `planner-group-panel` | **The details.** How much it makes against the most it could, what feeds it, and "Show what it feeds and needs" to light its whole chain. Escape closes it. | Next |
| 11 | Map | `map-canvas` | **The world.** Buildings, trains, drone ports and the player's own markers, on the game's map. | Next |
| 12 | Map | `map-filters` | **Choose what to see.** Turn layers on and off; try one. | Try-it (`changes: map-layer-toggle`; Do it for me toggles it) |
| 13 | Settings | `settings-alerts` | **Be told, don't watch.** Choose which problems send a notification, so the tab can stay closed. | Next |
| 14 | Settings | `settings-account` | **Account and servers.** Sign-in and the connected game servers are managed here. | Next |
| 15 | Overview | `demo-banner-tour` | **That's the tour.** Restart it from the banner any time. Everything resets when the page reloads. | Next |

To check in build PR 2: which group card step 9 points at (the planner's first view, and whether it needs an `?open=`
link, `PlannerView.tsx:42`); whether a map pin's click does anything (the map's notes describe tooltips only), which is
why step 12 toggles a layer instead.

## Build plan (each PR from `main`, no stacking)

| # | PR | Files | Proof |
|---|---|---|---|
| 1 | The engine | `demo/tour/` (`TourHost`, `Spotlight`, `Popover`, `placePopover`, `controller`, `steps` with steps 1-3, `target`, `tourStore`, `persistence`), the tokens and `.tour-scrim` in `index.css`, "Take the tour" in `DemoBanner`, the host in `Shell.tsx` | First: the clip-path with backdrop-filter in Chromium, WebKit and Firefox, screenshotted (and the fallback if one fails). Unit tests: the controller, persistence with storage throwing, the wait and its timeout, `placePopover` (each side, the viewport edges, nothing fits). RTL: the dialog's names, focus wrap, Escape, the live region. Design-token check. `build-output.spec.ts`: no `data-tour` or tour words in production, a tour chunk in the demo. |
| 2 | Targets and all 15 steps | `tour(...)` on the pages' elements, the planner panel's one attribute, the words | An e2e state per tab at 1440 and 390, with axe and screenshots (`npm run baselines`), `[style]` count 0 on the overlay, no CSP violation; the demo's e2e and `demo:video` set `demo.tour` first. |
| 3 | Try-it steps | The `appears` and `changes` detectors and Do it for me | e2e: a real click on the card, and Do it for me, each move the tour on. |

Each PR adds its `log.d` fragment; PR 3 adds pointers in `frontend/CLAUDE.md` and the demo's runbook. If PR 1's browser
check fails, this ADR is amended before PR 2.

## Files

- **Added:** `frontend/src/demo/tour/*` and their tests; `frontend/e2e/demo/tour.spec.ts` (or cases in the demo's
  existing spec); a log fragment per PR.
- **Changed:** `frontend/src/index.css`, `frontend/src/demo/DemoBanner.tsx`, `frontend/src/shell/Shell.tsx`,
  `frontend/e2e/build-output.spec.ts`, the demo e2e setup and `demo:video`, `frontend/CLAUDE.md`, this folder's README;
  one-line `tour(...)` spreads in the Overview, Power, Factory, Planner (canvas, a group card, the panel), Map (canvas,
  layer filters) and Settings components.

## Consequences

- The demo explains itself to someone who has never seen the game, in about three minutes.
- About fifteen strings of words must follow the UI. A tour e2e fails when a target goes, so they cannot rot silently
  (as ADR-0026 asks of the demo).
- The hole passing clicks through is what makes try-it steps possible without coupling the tour to any page.
- Production is unchanged: the targets and the host compile out, and CI checks it.

## Rejected

- **A tour library:** inline styles (Decision 1).
- **A modal `<dialog>`:** it makes the page inert, so a try-it step could not be done.
- **Popovers placed by coordinates through `element.style`:** allowed by the CSP but writes a `style` attribute, which the
  repo's rule and the `[style]` guards forbid. The `foreignObject`'s attributes do the same job within the rules.
- **CSS anchor positioning:** browser support not verified, and it would still need a fallback.
- **A popover docked in a screen corner** (the first proposal): simpler, but the owner chose one attached with an arrow.
- **Blurring the app and showing a copy of the target:** the copy is dead, so a try-it step could not work.
- **A "seen" flag on a server:** the demo has none.

## Open questions for the owner (recommended answer first)

1. **Start automatically only at the Overview (`/app`), not when someone arrives by a deep link?** Recommended: yes.
2. **Mark the tour seen when it starts, not when it ends?** Recommended: at the start (a reload half-way should not
   restart it; the banner button restarts it on purpose).
3. **The popover docked in a corner (v1), not attached to the target with an arrow?** Recommended: docked.
4. **Dimming without blur acceptable in a browser where the blur-with-hole does not work?** Recommended: yes.
5. **Keep all 15 steps, or cut to about 12?** Recommended: keep 15, each readable in under 15 seconds.

### Owner's answers, 2026-11-06

1. "Overview only". 2. "When it starts". 3. **"Attached with an arrow"** (not the recommendation): Decision 2's popover
is placed beside the target by a `foreignObject` with an SVG arrow from `sm` up, and stays a bottom sheet on phones.
4. "Yes, dim only there". 5. Not asked; the recommendation stands (all 15 steps) until the owner cuts any after seeing the
tour.

## Revisit when

- A real browser shows the blur with a hole does not work where it matters.
- The tour's words have gone stale more than twice.
- The tour is wanted in the production app (a new decision: real data, real first-time users).

## Build note, PR 1 (2026-11-06): the engine and steps 1-3

- **Browser check (Decision 2).** Playwright on a standalone page: Chromium dims and blurs everything but the hole, and
  clicks in the hole reach the element; moving the path's `d` moves the hole. WebKit and Firefox: the hole, the dimming
  and the clicks through it work; their blur could not be judged, since those Windows Playwright builds draw no
  `backdrop-filter` at all, even with no clip, and `@supports` says yes. Whether a real Mac's Safari and a real
  Firefox blur round the hole needs a look on a real device; if not, they are dim-only (the owner's answer 4).
- **Decision 8 corrected.** `IS_DEMO ? lazy(import(...)) : null` still wrote the tour's chunk, with its words, into the
  production build: the bundler does not fold the imported constant there. `Shell.tsx` also checks
  `import.meta.env.MODE !== "production"`, and `build-output.spec.ts` fails if the chunk or its words reach production
  (and checks the chunk is in the demo). The `data-tour` attribute never reaches production; the step ids passed to
  `tour("...")` (such as `overview-health`) do, as plain strings with no effect.
- **Decision 12.** `--color-scrim` already existed (the command bar's), so the tour reuses it. New: `--z-tour`,
  `--blur-tour`, `--spacing-tour-pad`, `--spacing-tour-popover`, `--spacing-tour-sheet`.
- **Steps.** Step 1, the welcome, has no target and shows centred at once (a step may now have none; `ui-reviewer`).
  Step 3's target is the header's alerts bell, since the Overview has no alerts list. Its words now say "a machine that
  has stopped working or power running short". The live region says only "Step N of M" (the focused heading says the
  title). While the next step's target is awaited, the last step stays on screen so focus is not lost; a page change
  made through the hole is never undone.
- **Reviews.** `test-hunter`: the popover could be placed off screen when the target was wholly outside the viewport;
  it now centres (regression test). `ui-reviewer` (diff only): nothing blocking; for PR 3, an Escape that works with
  focus on the page, and Tab reaching the target, on try-it steps.

## Build note, PR 2 (2026-11-06): targets and steps 4-15

- **Targets** (each `{...tour(id)}`, `{}` outside the demo; `e2e/build-output.spec.ts` still fails on any `data-tour` in
  production): `power-chart` on the first circuit's history article (`power/PowerHistoryPanel.tsx`: the chart and its
  production and consumption summary); `power-circuits` on the circuit cards' list (`power/PowerPanel.tsx`);
  `factory-machines` on the machines section (`factory/FactoryPanel.tsx`); `factory-bottlenecks` on the bottleneck card
  (`factory/BottleneckSummary.tsx`); `planner-canvas` on the graph's viewport, `planner-group-card` on one card's `<g>`
  (the first card of a group of machines, picked in `planner/graph/SiteGraph.tsx` in the demo build only) and
  `planner-group-panel` on the panel's `<aside>` (`planner/graph/GroupPanel.tsx`); `map-canvas` on the Leaflet host
  (`map/MapCanvas.tsx`); `map-filters` on the layer checkboxes' fieldset (`map/MapPanel.tsx`); `settings-alerts` on the
  first rule's card, the power outage's (`alerts/rules/RulesEditor.tsx`, `RuleCard.tsx`); `settings-connection` on the
  game connection's status rows (`agent/AgentSettings.tsx`). The whole Rules part (five rules) and the whole section are
  taller than a phone's screen, so the highlight would run off both ends. `planner-view-graph` on the planner's Graph
  view button (`planner/PlannerPanel.tsx`), an opener only.
- **Corrections to Context and "To check in build PR 2".** The planner's address keeps the opened factory path
  (`?open=`), not the group panel, which is the canvas's own state, so no link reaches step 10. A step may now name
  `openedBy`, one target or a chain: each in turn, once ready, gets a bubbling click as "Do it for me" will, unless the
  step's own target or a later opener is already there (TourHost, RTL tests). Each opener must be an idempotent "show".
  Step 10 has `openedBy: ["planner-view-graph", "planner-group-card"]`. And the Reinforced Iron Plate
  group is a bubble of two assemblers that opens in place, with no panel. The planner steps open the Plastic line
  instead, whose one group of machines is the oil refinery: steps 8-10 go to
  `/app/planner?open=factory%7Cdesignation%7C6f1c2a4e-3b5d-4c7a-9e1f-0a2b3c4d5e6f` (`designatedKeyOf(DEMO_DESIGNATION_ID)`;
  `steps.test.ts` checks it against `OPEN_PARAM` and the demo world).
- **Phones: the planner switches to Graph** (owner's answer, 2026-11-06). Below `sm` the planner opens on its Outline
  (ADR-0050 Decision 4), with no canvas, card or panel. Steps 8 and 9 have `openedBy: "planner-view-graph"`, so the
  tour presses Graph only when the canvas is not there (never on a wide screen), and step 10's chain presses it again
  after Back from the map remounts the planner. Accepted side effect: the visitor's planner is left on Graph for that
  visit. On a phone the group panel is the canvas's floating card, its `<aside>` still the target.
- **Words changed from the table** (with `ui-reviewer`'s copy edits). 1: "Nothing here is live data." 4: "compares power
  made with power used" (the chart draws production, consumption and a dashed capacity line). 5: "What is a circuit?";
  "power plants" for generators; "how much of its capacity is in use" is what each card says. 6: grouped by factory,
  "Each group counts the backed-up ones" (the filters are Backed up, Paused and No recipe, none for underfed). 7: "worst
  first, one line each: underfed or backed up". 8: names the Plastic line. 9 (a Next step until PR 3): "Clicking a box
  opens its details", naming the refinery. 10: "Inside a group."; "Escape closes it" dropped (with focus in the popover,
  Escape leaves the tour); "Close puts it away". 11: the layers that are on at first. 12 (a Next step until PR 3): belts,
  pipes and power lines start hidden. 13: "Each rule, like this one for a power outage". 14, now "Connecting a game": the
  demo user is the server's owner with no account methods, so the account part is one line ("You own Demo factory"); the
  target is the game connection's status rows ("These lines say whether it is linked and online now"), renamed from
  `settings-account`. 15: "Restart it from this button".
- **Tests.** `steps.test.ts` (15 steps, unique ids, at most 50 words each, every path a tab, every target marked in the
  source, every opener marked, the planner link); `TourHost.test.tsx` (`openedBy` clicks once, not again while open, a
  chain in turn, and a missing opener falls back centred);
  `SiteGraph.tour.test.tsx` (one marked card, a group of machines, whose click opens the marked panel);
  `DemoApp.test.tsx` (the Power, Factory and Settings targets in the demo app). `e2e/demo/tour.spec.ts` walks all 15 with
  Next at 1440 and 390: each heading, the ring round its target (only the welcome centred, phones included), `[style]` 0 on the overlay,
  axe on five steps, screenshots of four (new baselines, `npm run baselines`), and step 10 opening its panel by itself,
  again after Back.

## Build note, PR 3 (2026-11-07): the try-it steps

- **Built as Decision 6 says**, in `demo/tour/tryIt.ts`: step 9 is `done: { appears: "planner-group-panel" }`, step 12
  `done: { changes: "map-layer-toggle" }`, both `doForMe`. Once done the tour moves on by itself; step 10 then shows the
  panel just opened at once, since its openers press nothing while their step's target is there. Next stays enabled.
- **`appears` means new.** An element with that `data-tour` that was not there when the step began: Back from step 10
  leaves the panel open, and a plain "is it there" would jump straight forward again.
- **`changes`** is a `change` event on or inside the target, listened for in the capture phase (a page handler that stops
  it cannot hide it).
- **Step 12's target moved.** The ADR highlighted the layer fieldset (`map-filters`), but Do it for me needs one box to
  press and the words now ask for one. `map-layer-toggle` marks the Belts and pipes label (a layer hidden at first) in
  `map/MapPanel.tsx`; it is the step's target, its `changes` target and what Do it for me presses (a label through its
  checkbox, so `change` fires). The fieldset is no longer marked. The step's id stays `map-filters`.
- **"If nothing registers within the wait"** is read as: after Do it for me, if the step is not done within
  `TOUR_TARGET_WAIT_MS`, the tour goes on as Next would. Do it for me shows only while the target is highlighted, and goes
  once pressed (focus moves to the popover's heading).
- **Decision 9 amended.** Escape leaves the tour from anywhere on the page (a document listener), not only the popover,
  except while typing in a field or when the page handled it first: the group panel stops its Escape, and the planner
  canvas's Escape that closes the panel now calls `preventDefault` like the rest of its Escape chain (`SiteGraph.tsx`).
  On try-it steps Tab wraps through the popover's buttons and the target. The SVG card takes no focus, so a step can name
  `keyTarget`, its keyboard path: `planner-group-card-key` on the card's visually hidden button. The live region says
  "Done. Step N of M" once on arriving by a try-it step, not a separate "Done.".
- **Two fixes from CI's phone run.** (1) A late "lost": the last step's element, gone with its page, could be seen gone
  on a frame after the next step's target was found but before React rendered it, which knocked the new step to the
  centred fallback (step 13, Settings, on phones). A loss now counts only for the target currently set (a
  deterministic RTL test runs that frame by hand). (2) On a phone the planner's canvas had the refinery card panned off
  the screen: the ring was round it but nothing could be tapped (Do it for me worked, a real tap could not). A step's
  `keyTarget` is now focused for an instant on arrival, so the planner pans to the card as it does for a keyboard user,
  and focus goes straight back. The e2e walk checks every try-it target is on screen.
- **Not done:** the ADR's pointer in "the demo's runbook": there is no demo runbook (`docs-vault/wiki/runbooks/`).

## Amendment, 2026-11-07: no pop-in, and which tab

The owner, after walking the tour: "Clicking through the tour means jumping to components that arent loaded in yet so
they pop in oddly. Also the user cant tell which tab each item is on since its blurred (dont know which tab has the
power graph)".

- **Decision 4, waiting for the page, now also waits for it to settle.** Soon after the tour starts (once idle,
  `lib/idle.ts`, so the Overview it starts on loads first; skipped under Save-Data like the app's other speculative
  loads) it warms everything it will visit (`demo/tour/warm.ts`): the lazy chunk of each step's page (the power chart, the planner's graph, the map's
  canvas, the very modules the pages load lazily) and each distinct page's primary queries, through
  `shell/pageQueries.ts` as a nav link's hover prefetches them. A step on a new page (or one whose target only a click
  shows) shows only once its target is ready as before and its box has kept still within 1 px for `TOUR_SETTLE_MS`
  (200 ms), measured on animation frames. `TOUR_TARGET_WAIT_MS` still bounds the whole wait. A step on the same page
  shows at once.
- **Decision 4, the wait itself.** PR 1 kept the last step on screen while the next was awaited. Over a page changing
  underneath that was the jumpy part, so going to a new page now shows only the plain scrim: dimmed, no hole, no ring,
  no popover. That reads calmer than the old popover without its hole, which would point at nothing and then jump
  across the screen to its new place. Focus waits on a visually hidden holder inside the tour (`role="dialog"`, named
  "Guided tour"), so the shell's move to the new page's heading cannot take it out of the tour. The new step then fades
  in with the existing token animation, which is off under reduced motion.
- **Decision 2, a second hole for the tab.** The scrim's evenodd path also cuts a hole round the step's page's tab in the
  top nav (`data-tour="tab-<page>"`, put on each NavLink by `tour(...)`, so nothing reaches production), with a 1 px
  `muted` ring, not the accent one, so the target stays the main thing. The hole is dropped where it would overlap the
  target's (evenodd would dim the overlap again). It stays clickable: it only goes to the page already shown. The nav,
  which scrolls sideways on phones, is scrolled to show the tab (instantly, the nav only, never the page). There is no
  menu hiding the tabs on phones; a tab with no box would get no hole. The welcome and the finish get the Overview tab.
- **Decision 4, scrolling to the target.** Centring every target (`block: "center"`) scrolled the nav, and so the tab's
  hole, off screen for any target below the fold (the Power chart at 1440 x 900 and on phones, in CI's screenshots).
  Fitting the target and the tab on screen together was tried first and failed in CI: the Power chart sits too low on
  the page for both in 900 px. **Owner's answer (2026-11-07): pin the tab bar while the tour runs, demo only.** The tour
  sets `data-guided-tour` on `<html>` while it runs (removed on exit), and `index.css`'s
  `:root[data-guided-tour] .tour-pin` makes the shell's tab row `sticky` at the top (`--z-sticky`, the page's
  `--color-canvas` behind it). The shell adds `.tour-pin` in the demo build only, so production renders no such class and
  the rule is inert there (no `data-tour` text reaches its CSS). So the tab, in its hole, is always on screen, and each
  target is scrolled (instantly, `scrollToShow` in `placePopover.ts`) the least that shows it below the pinned row and
  above a phone's bottom sheet, or, when taller than that room, with its top just under the row, never behind it. The
  planner card's pan through its keyboard button runs first, as before. Known overlap: on Factory the page's own sticky
  filter bar (also `--z-sticky`, top 0) can slide under the pinned row while the tour runs.
- **Decision 9, the words.** The popover's step line and the live region lead with the tab: "Power tab · Step 4 of 15"
  ("Done. Power tab · Step 10 of 15" after a try-it step), the label read from the nav's own list (`shell/tabs.ts`); a
  page that is no tab keeps "Step N of M".
