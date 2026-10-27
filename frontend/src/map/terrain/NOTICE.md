# Terrain shapes

`terrain.json` holds the Map page's terrain base map: the coast, the shallows and three height bands of
Satisfactory's world, as simplified polygons in world metres. They were traced by `scripts/map-terrain.mjs` (with
`scripts/map-terrain.palette.json`) from the game's own world map texture (`Interface/UI/Assets/MapTest/SlicedMap`,
four tiles), exported by the owner from their game install with FModel and downscaled to 512 px each (1,024 px
across the world, about 7 m a pixel). The texture itself
is not in this repository; only these derived shapes are.

- The shapes are derived from Satisfactory's map, © Coffee Stain Studios. Like the icons in
  `frontend/public/game-assets/` (see its NOTICE.md), they are **not** covered by this repository's AGPL-3.0-only
  licence, and they are used as fan content in a free, non-commercial tool. This project is not affiliated with
  Coffee Stain Studios.
- They will be removed on request from the rights holder: set `TERRAIN_ENABLED` in `../terrain.ts` to false and
  delete this folder; the Map page falls back to its neutral grid.

To rebuild: export the four `SlicedMap` tiles, downscale each with
`npx sharp-cli@6.1.0 -i Map_<col>-<row>.png -o . -f png resize 512 512 --fit fill`, then
`node scripts/map-terrain.mjs trace scripts/map-terrain.palette.json frontend/src/map/terrain/terrain.json Map_0-0.png Map_1-0.png Map_0-1.png Map_1-1.png`.
