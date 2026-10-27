- **2026-10-27, map filter columns (owner bug):** with the resource node and building layers both on, the long
  "Resource types" list made the grid row tall and the shorter "Resource nodes in use or free" and "Building states"
  groups stretched to match, spreading their legend, All/None row and options over the height. Each filter group
  (`frontend/src/map/MapFilterPanel.tsx`) now packs its rows to the top (`content-start`); a test pins it.
