## [2026-10-26] feat | Map page terrain traced from the game's map

The Map page's base now draws the island under the grid: land, shallows and two height bands, in the dashboard's own
colours (`--color-terrain-*`), from shapes traced once out of the game's world map texture by the new
`scripts/map-terrain.mjs` (dependency-free: Node's zlib decodes the PNG tiles). The texture never enters the repo; the
shapes (`frontend/src/map/terrain/terrain.json`, 89 kB gzipped, its own chunk) carry a NOTICE and a takedown switch.
ADR-0023 decision 4 amended (#571: traced shapes, not an image), LEGAL.md and `frontend-planner-map.md` updated, the
texture's layout and alignment evidence in `raw-sources/factorygame-world-map-texture-2026-10-26.md`. The grid lines
move to their own token, `--color-map-grid`, so they still read over the land.
