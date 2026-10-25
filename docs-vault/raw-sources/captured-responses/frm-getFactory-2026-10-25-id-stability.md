# FRM `getFactory`: building ids across a dedicated-server restart (2026-10-25)

**Question (ADR-0055, designations):** does a building keep its FRM `ID` (e.g. `Build_OilRefinery_C_2146846637`)
after the dedicated server stops and loads the save again?

**Method:** two read-only `GET /getFactory` captures from the owner's live server (FRM web server on the game PC),
one on 2026-10-24 and one on 2026-10-25 after the owner restarted the server through the server manager (a clean save,
stop and start). Compared by `ID`, and by `ClassName` plus `location` rounded to whole units.

**Result:**

| | Count |
|---|---|
| Buildings before / after | 340 / 340 |
| `ID`s present in both | 340 |
| `ID`s only before / only after | 0 / 0 |
| Same class and position with a different `ID` | 0 |
| Matched `ID`s whose exact `location` changed | 0 |

**Conclusion:** `ID`s are stable across a save-and-reload of the same save. They are the actors' saved object names,
so this is expected. Not covered by this capture: a building dismantled and rebuilt (a new actor, so a new `ID`), a
blueprint placed again, and a save loaded on a different game version. A designation can key on `ID` and fall back
to class and position (within a small tolerance) only for members whose `ID` is no longer found.

The captures themselves (the whole factory) are not committed; only these counts are.
