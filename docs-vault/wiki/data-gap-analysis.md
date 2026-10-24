# Data gap analysis

Tracks which player-facing metrics are covered by an existing API vs. which require a
custom mod. Phase 2 spike run 2026-09-21: local dedicated server (GameVersion 1.2.4.0,
CL 502094) + SML 3.12.0 + FRM 1.5.3, both APIs hit with real requests. See
`vanilla-dedicated-server-api.md` and `frm-api.md` for the full writeup; this table is
the summary.

| Metric | Source | Status |
|---|---|---|
| Production rate per building | FRM `getFactory` (`production[].CurrentProd`/`MaxProd`/`ProdPercent`) | **Covered and live-verified (2026-09-22).** Per minute, clock speed already included, percent on a 0-100 scale; fluids in m³/min matching the game UI. See `frm-api.md`. Gap: `getFactory` gives no per-item solid-vs-fluid flag, so the unit (items/min vs m³/min) can't be labelled reliably yet ([NEEDS VERIFICATION] whether another FRM endpoint provides it). |
| Overflow (belt backed up) | FRM `getFactory` (`OutputInventory[].Amount` == `MaxAmount`, machine configured and not paused) | **Covered, indirectly; live-checked 2026-09-22.** No direct "belt full" field exists anywhere, including `getBelts`. The original proxy also required `IsProducing: true`, which never matches: a machine with a full output stops producing (71 of 71 full-output machines read `IsProducing: false`). `OutputInventory` lists only non-empty slots, and fluid outputs do appear there, so refineries are probably covered too. [NEEDS VERIFICATION] with a deliberately blocked refinery before relying on it for fluids. |
| Power outage / deficit | FRM `getPower` (`FuseTriggered`, `PowerConsumed` vs `PowerCapacity`, `PowerMaxConsumed`, battery fields) | **Covered and live-verified (2026-09-22).** MW values match the in-game panel; a tripped fuse reads `FuseTriggered: true` with production/consumption/capacity at 0; battery units confirmed. `getPower` is keyed by circuit *group* (`CircuitGroupID`), which differs from a building's `CircuitID` when a switch is involved. FRM also has a built-in webhook (`DiscIT.OutageJSON`) that could be used instead of/alongside polling — undecided, see `frm-config.md`. |
| Player position/inventory | FRM `getPlayer` | **Covered.** Schema confirmed from docs; endpoint reachable live (empty, no players connected during the spike). |
| Server health / uptime | Vanilla HTTPS API `HealthCheck` + `QueryServerState` | **Covered and live-confirmed.** Both hit successfully against the running server; response casing is camelCase in practice (docs show PascalCase) — see `vanilla-dedicated-server-api.md`. |
| Simulation paused (values frozen) | Vanilla `QueryServerState` (`isGamePaused`) | **Covered and live-verified (2026-09-22).** True when the server's auto-pause has paused the game with no players connected; FRM values are frozen while it is. |

No row currently needs a custom mod — every stated metric has a documented, reachable
API source. Open items: the blocked-refinery check for fluid overflow, a per-item
solid/fluid source for labelling units, and confirming whether FRM's tunneled Game Port
transport (documented as a fallback) actually works on this version — it returned
`404` in the 2026-09-21 spike, so the adapter targets FRM's direct Web Server instead
(see `frm-api.md`).

## Power: FRM `PowerProduction` is base production, not total (#620)

Owner decision (2026-10-24, option A): the dash's circuit "production" (`productionMW`) is the TOTAL produced, as the
in-game power graph shows "Produced". It is derived on the FRM path as `max(PowerProduction, PowerConsumed)` per circuit
group (`packages/game-adapter/src/totalPowerProduction.ts`).

Evidence (none of it is in `raw-sources/` yet, so all of it is [NEEDS VERIFICATION]):

- FRM 1.5.4 `Power.cpp:47`: `PowerProduction = mBaseProduction`, the generators' base output only. [NEEDS VERIFICATION]
  `raw-sources/frm-getPower.md` only says "Power production of the circuit."
- SML 3.12.0 `FGPowerCircuit.h:426-433` and `:104` (`PowerProduced`): the circuit's total produced, which FRM does not
  forward. [NEEDS VERIFICATION]
- Test-server observation from the mod session (2026-10-23): a demand-following grid read 0 MW base production with 4 MW
  consumed, while the game showed 4 MW produced. The owner's grid read 3,633 base with 1,314 used (base above draw, so
  the total equals base). [NEEDS VERIFICATION: no capture file]

Derivation rule: a circuit cannot consume more than it produces, so `max(base, consumed)` is exact when the grid follows
demand and when base exceeds the draw. Fits both observations above.

Battery caveat [NEEDS VERIFICATION]: with batteries, discharge may be counted as production in the game's figure. The
same rule is kept; no battery heuristic is invented.

Follow-ups:

- Capture `getPower` + `getGenerators` on a demand-following grid, with and without batteries, into `raw-sources/`, and
  check the rule against the in-game graph.
- Exact alternative if the rule proves wrong: sum `getGenerators` `BaseProd` + `RegulatedDemandProd` per circuit
  (FRM `Power.cpp:382-385`). [NEEDS VERIFICATION]
