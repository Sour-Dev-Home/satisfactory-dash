# World coordinates: units and map bounds

Captured 2026-09-24 for ADR-0023 (live factory map). Two independent sources, both about how
Satisfactory's world coordinates (the `location { x, y, z }` FRM reports per building,
`frm-getFactory.md:23-27`) relate to metres and to a 2D map. Neither is official; treat the
figures as **decently imprecise** (the project owner's words) and confirm with an in-game check.

## Source A: SCIM (community interactive map)

- Repository: github.com/AnthorNet/SC-InteractiveMap, file `src/GameMap.js`, lines 33-36
  (last commit on that file: 2026-07-23).
- Only these four numbers are taken, in game units. No SCIM code or tiles are used.

| Bound | Game units |
|---|---|
| mappingBoundWest | -324698.832031 |
| mappingBoundEast | 425301.832031 |
| mappingBoundNorth | -375000 |
| mappingBoundSouth | 375000 |

Divided by 100 (if the game unit is a centimetre): west -3246.99 m, east 4253.02 m,
north -3750 m, south 3750 m. That is a 7,500 m square.

## Source B: a community answer on Reddit

- Pasted into the project by the owner. URL:
  https://www.reddit.com/r/SatisfactoryGame/comments/xe8nrv/how_do_the_ingame_map_coordinates_work/
  (URL supplied by the owner 2026-09-24; content as he pasted it; reddit blocks automated
  fetches, so not machine-verified).
  Author names are deliberately not recorded here.
- Claims: `coordinates / 100 = metres`; +x is right (east) and +y is down (south); on the
  5000 x 5000 px map, 1 px = 1.5 m, and the origin (0, 0) is at pixel (2163, 2500).
- Derived: a 7,500 m square, west edge at -2163 x 1.5 = -3244.5 m. That agrees with Source A's
  -3246.99 m to about 2 m.
- The same thread quotes a "7.972 x 6.8 km" world. That is a different extent, does not match
  Source A, and is **not used**.

## What this supports

- The game unit is the centimetre (both sources), which matches the project's own capture:
  333 of 338 buildings on a 100-unit grid (`captured-responses/frm-getFactory-2026-09-22-01-running-trimmed.json`).
- Axis orientation: +x east, +y south.
- Approximate world bounds for a base-map config (ADR-0023, decision 3).

Still to confirm in game: two buildings a known distance apart, and one known landmark.
