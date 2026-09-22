# Data gap analysis

Tracks which player-facing metrics are covered by an existing API vs. which require a
custom mod. Phase 2 spike run 2026-09-21: local dedicated server (GameVersion 1.2.4.0,
CL 502094) + SML 3.12.0 + FRM 1.5.3, both APIs hit with real requests. See
`vanilla-dedicated-server-api.md` and `frm-api.md` for the full writeup; this table is
the summary.

| Metric | Source | Status |
|---|---|---|
| Production rate per building | FRM `getFactory` (`production[].CurrentProd`/`MaxProd`/`ProdPercent`) | **Covered.** Schema confirmed from docs (`raw-sources/frm-getFactory.md`); endpoint reachable live and returns well-formed JSON, but the save had no buildings placed, so field values themselves aren't live-verified yet — schema-confirmed, not fully live-confirmed. |
| Overflow (belt backed up) | FRM `getFactory` (`OutputInventory[].Amount` == `MaxAmount` while `IsProducing: true`) | **Covered, indirectly.** No direct "belt full" field exists anywhere, including `getBelts` (confirmed — see `frm-api.md`). The output-inventory-at-capacity proxy is inferred from documented fields, not itself documented as an overflow signal — validate against a real backed-up factory before relying on it. |
| Power outage / deficit | FRM `getPower` (`FuseTriggered`, `PowerConsumed` vs `PowerCapacity`, `BatteryDifferential`, `BatteryPercent`) | **Covered.** Schema confirmed from docs; endpoint reachable live (empty response, no power circuits in the fresh save). FRM also has a built-in webhook (`DiscIT.OutageJSON`) that could be used instead of/alongside polling — undecided, see `frm-config.md`. |
| Player position/inventory | FRM `getPlayer` | **Covered.** Schema confirmed from docs; endpoint reachable live (empty, no players connected during the spike). |
| Server health / uptime | Vanilla HTTPS API `HealthCheck` + `QueryServerState` | **Covered and live-confirmed.** Both hit successfully against the running server; response casing is camelCase in practice (docs show PascalCase) — see `vanilla-dedicated-server-api.md`. |

No row currently needs a custom mod — every stated metric has a documented, reachable
API source. The two open items are validating real (non-empty) responses once
buildings/players exist in a save, and confirming whether FRM's tunneled Game Port
transport (documented as a fallback) actually works on this version — it returned
`404` in this spike, so the adapter should target FRM's direct Web Server instead
(see `frm-api.md`).
