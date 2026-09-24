# ADR-0015: Item form (solid vs fluid) from the game's CommunityResources catalog

Status: accepted (project owner), 2026-09-24

## Context
Production rates are "per minute" with no unit, because no API response says whether an item is
solid or fluid (ADR-0006; MaxAmount doesn't distinguish them). The owner asked to set each item's
unit by hand and have the dashboard remember it.

However, form is a fixed property of each item, the same for every user and server. The game
ships it: `CommunityResources/Docs/en-US.json` in the game install (UTF-16 JSON) gives every
item's `mForm`. Checked on the owner's install on 2026-09-23:
- 195 items with a form: 180 RF_SOLID, 10 RF_LIQUID, 5 RF_GAS
- RF_INVALID entries are non-items
- spot checks: LiquidFuel, LiquidOil, HeavyOilResidue and Water are liquid; NitrogenGas is gas;
  Plastic, Stator and PolymerResin are solid. That also resolves ADR-0006's Polymer Resin
  [NEEDS VERIFICATION].
CommunityResources is published by Coffee Stain in the game install for community tools.

## Decision
- **Catalog:** a generated, committed mapping `{ className -> "solid" | "fluid" }`. RF_LIQUID and
  RF_GAS both map to fluid, since both are measured in m³ in game.
  - It's produced by a script from the Docs file (`npm run update-item-forms -w backend -- <path>`).
  - It commits ONLY class names and forms (a few KB), never the whole Docs file, with a header
    recording the game version and date.
  - It lives in the telemetry module (backend-internal data).
- **Contract (additive, ADR-0007):** `ProductionRate.unit: "items/min" | "m3/min" | null`,
  resolved by the backend. null = className not in the catalog (e.g. a modded item or one newer
  than the catalog); the UI then shows "per minute". The frontend never joins or guesses (ADR-0006).
- **Unknown items:** the backend logs one warning per unknown className per process, so gaps are
  measurable.
- **No manual per-user setting and no storage** for vanilla items. The owner's manual-override
  idea becomes the fallback for unknown items, built only on the trigger below.
- **Update procedure:** after a game update, rerun the script and commit the diff. CI can't reach
  the game files, so the committed catalog is the source of truth.

## Consequences
- Correct units for every vanilla item with zero user input, no database, and no per-user state.
- Extra upkeep: regenerate after game updates that add items. Until then, new items show
  "per minute" (safe fallback).

## Revisit when
- The unknown-className warning fires on a real server (modded items). Then add operator
  overrides: a per-account (later per-server) `className -> form` override. Storage follows
  ADR-0009: Postgres when accounts exist, or a small JSON settings file in single-operator mode.
