# Overview cards brief: Players, Tick rate, Health (frontend)

Status: architect brief, 2026-09-24. Owner request (relayed by reactapps-dc, 2026-09-24). Phase 1
is frontend-only, using fields already in the contract. Phase 2 ("who is connected") is ADR-0029.

## Evidence
- `StatusSchema` already carries `connectedPlayers`, `playerLimit`, `tickRate` (the server's
  average ticks/s) and `tickHealth` (`healthy | slow`) (packages/shared/src/status.ts:6-21).
- The only authoritative threshold: the vanilla API reports "healthy" when the tick rate is above
  10 ticks/s, else "slow" (raw-sources/dedicated-server-api.md:310).
- Observed values: a fresh save runs at 29.9 ticks/s (captured-responses/vanilla-QueryServerState-sample.json).
  The owner's large factory runs at 21.4-21.8 ticks/s, even while healthy
  (captured-responses/vanilla-QueryServerState-2026-09-22-*). The player limit is 4 in every capture.
  **There's no documented "target" rate** [NEEDS VERIFICATION if one is ever cited].
- The Overview already derives an overall health (healthy/degraded, with a summary) in
  frontend/src/overview/health.ts:30-34, and StatusPanel shows players and ticks as text today.

## Shared rules for all three cards
- Each card is its own component under `frontend/src/overview/cards/`, laid out as a grid on the
  Overview (mobile: one column).
- **Graphics are our own inline SVG components.** No third-party clipart, icon fonts or image
  CDNs (licensing, and the CSP stays `'self'`). Colour via `currentColor` and the design-token
  classes: **never a `style=` attribute** (style-src 'self' blocks inline styles; SVG
  presentation attributes like `fill`/`stroke` are fine).
- Accessible: the graphic is `aria-hidden`, and the card carries the real text ("2 of 4 players
  connected", "21.5 ticks/s, healthy"). Animation respects `prefers-reduced-motion` (none or a
  static rendering).
- Demo data per ADR-0026 item 6: the demo world varies players (0 to 4 over a few minutes) and
  the tick rate (it already oscillates around 29.6). Add a "slow" episode so every state is
  demonstrable.
- A missing or paused game (`isGameRunning` false, `gamePaused`): each card shows a neutral
  "Game not running / paused" state, never a red alarm.

## 1. Players card
- A cluster of stick figures: **filled = connected, outlined = free slots**, up to `playerLimit`.
- Above 8 slots, show 8 figures plus "+N" (a mod or config can raise the limit). With
  `playerLimit` 0 (no game), use the neutral state.
- A small, gentle figure drawing (the owner said "little clipart stick figures"), drawn once as
  a single `StickFigure` SVG component.
- Phase 2 adds names beside the figures (ADR-0029). Keep the layout room for a short list now.

## 2. Tick rate card: **owner decision 2026-09-24: A, the semicircle gauge**
- The value is `tickRate` to one decimal, with the unit "ticks/s".
- **Bands follow the one documented rule:** below 10 = "slow" (danger colour, matching
  `tickHealth`); 10 and above = normal. Optionally a soft "strained" band from 10 to 15.
  **Never colour 20-25 as a warning**: that's the owner's normal, healthy large-factory rate.
- The scale runs from 0 to 30, where 30 is a fresh save's rate (an observation, not a spec).
  Values above 30 clamp at the end of the dial.
- Options for decision 1:
  - **A: a semicircle gauge dial** with a needle and the red zone below 10 (static, most
    readable; recommended)
  - **B: a clock face** whose second hand sweeps faster at higher tick rates. It's animated,
    and reduced motion gets a static hand at the value.
  - **C: a small line chart of the tick rate over the last minutes.** Needs the backend to
    sample the tick rate (not collected today), so it comes later with ADR-0027's history.

## 3. Health card
- Extract the existing overall health (health.ts) into its own card: the state (healthy /
  degraded / down / paused) plus its one-line summary, with an icon of our own. No new logic in
  this PR, just its own component and tests.

## PRs (frontend owns all; each QUICK + ui-reviewer; separate from the queued Power-tab layout-shift bug)
1. The card grid + Health card extraction (no behaviour change; screenshot parity).
2. The Players card + demo data variation.
3. The Tick rate card: the semicircle gauge (option A, chosen), static, with the red zone below 10
   only, the value as text, and the scale 0-30 clamped.
Phase 2 follows ADR-0029 (dev: the contract and route; then the frontend: names in the Players card).
