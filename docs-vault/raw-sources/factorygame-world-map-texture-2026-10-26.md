# FactoryGame: the world map texture (2026-10-26)

Source: the owner's FModel export of the game's `FactoryGame/Content/FactoryGame/Interface/UI/Assets/MapTest/` folder
(game build as installed on 2026-10-26), and the SML modding project's `Content` folder, which has placeholder assets
at the same paths. Read for the Map page's terrain base (ADR-0023 decision 4, amendment 2026-10-26). Names, layout and
sampled colour values only; no texture is copied into the repo.

## Files

| Asset (under `Interface/UI/Assets/MapTest/`) | What it is |
|---|---|
| `SlicedMap/Map_0-0`, `Map_1-0`, `Map_0-1`, `Map_1-1` | The world map in four square tiles, named `Map_<column>-<row>`: 0-0 north-west, 1-0 north-east, 0-1 south-west, 1-1 south-east (checked by eye: the coasts and the black out-of-bounds area continue across the seams). |
| `HeightData_Test` (`.hdr`) | Looks like a heightmap of the same world [NEEDS VERIFICATION]; not used yet. |
| `Map_Test_Gradient` | A small gradient; not used. |

That the in-game map draws from `SlicedMap` is inferred from the names and the content, not from the game's code
[NEEDS VERIFICATION]; for the terrain only the picture matters.

## Colours (stitched at 1,024 px, quantised to 16 levels per channel, most common first)

Sea `[72, 104, 120]` 24%; out of bounds (black) `[8, 8, 8]` 17%; the land in three bands, brown-tan lowland
(`[152, 136, 120]`, `[136, 120, 104]`), grey-green upland (`[152, 152, 136]`, `[136, 136, 120]`) and pale peaks
(`[184, 184, 168]`, `[200, 200, 184]`); shallows and rivers a light teal (`[72, 152, 168]`, `[72, 136, 152]`). The
land colours follow height, not biome. The full palette used is `scripts/map-terrain.palette.json`.

## Extent

The four tiles together cover the 7,500 m square of `world-coordinates.md` (SCIM's bounds). Check: the positions in
`captured-responses/frm-getResourceNode-2026-09-27-trimmed.json`, `frm-getResourceWell-2026-09-27-trimmed.json` and
`frm-getFactory-2026-09-22-01-running-trimmed.json` (30 points, spread over the whole island) fall on the traced land
28 times out of 30 at no offset; shifted by 100 m or 250 m north, south, east or west, never more (23 to 28). The two
misses sit in lakes or shallows. The owner's in-game check on their own save is still to come.
