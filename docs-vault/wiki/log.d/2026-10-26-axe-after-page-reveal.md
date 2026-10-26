- 2026-10-26 — Steadied the e2e axe check, which failed the `deploy-gap` state at random with colour-contrast
  violations (#701's run). With its reads unanswered, the page reveals only once `--duration-reveal-budget` passes,
  sometimes after `settleAnimations` had looked, so axe measured the text mid-fade. `expectNoAxeViolations` now
  waits until no `[data-page-reveal="waiting"]` is left before settling, for every axe call.
