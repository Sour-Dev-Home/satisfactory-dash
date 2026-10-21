# FRM conveyor G-checks (ADR-0048 G-B1, G-B2), 2026-10-21

Source: the mod session's manual session on the TEST server (the mod harness, run 39642650093, game port 17777), not
the owner's save. FRM 1.5.4, read-only over its web server: `/getBelts` and `/getPipes`, trimmed to `ID`, `ClassName`,
`ConnectedTo0`, `ConnectedTo1`, `ItemsPerMinute` / `Speed`. Reported to the dash session by the mod session; recorded
here as received.

## G-B1: rebuild staleness (belts A → B → C, Mk.1)

| Step | Read after it |
|---|---|
| Built | A `…455581` {0: `""`, 1: B `Build_ConveyorBeltMk1_C_2147455502`}; B {0: A, 1: C}; C `…455405` {0: B, 1: `""`}. Adding C changed the existing B's `ConnectedTo1` from `""` to C. |
| B dismantled | B is gone from the list; A's `ConnectedTo1` and C's `ConnectedTo0` are `""`. Nothing refers to `…455502`. |
| B rebuilt | A NEW id, `Build_ConveyorBeltMk1_C_2147455285` {0: A, 1: C}; A's `ConnectedTo1` and C's `ConnectedTo0` are `…455285`. The old id did not come back. |

Every change showed on the first read after it. In the world's 1,987 belts at the start: 1,032 belt-to-belt links,
none pointing at a missing id.

**Result: pass.** `ConnectedTo` is not stale. A rebuild changes the id, so an id is good only within one read, never a
durable key.

## G-B2: the unit of a pipe's `Speed`

- All 156 `Build_Pipeline_C` (Mk.1) in the world: `Speed` 5.
- Three new, empty `Build_PipelineMK2_C`, chained by `ConnectedTo`: `Speed` 10 each.
- Mk.1 is rated 300 m³/min (300 / 60 = 5) and Mk.2 600 m³/min (600 / 60 = 10). Empty pipes still read 10.

**Result: pass.** `Speed` is the pipe tier's rated capacity in m³/s, not live flow: ×60 for m³/min.

Same pattern on belts: `ItemsPerMinute` is the tier's maximum (Mk.1 60, Mk.2 120, Mk.3 270, Mk.4 480 across the whole
world), not throughput.
