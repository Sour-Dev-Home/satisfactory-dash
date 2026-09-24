# ADR-0023: Live factory map: contract, coordinates, map library, layer plug-ins

Status: accepted (project owner), 2026-09-24

## Context
The live map is the product's end-goal feature (ADR-0014): buildings drawn at their real in-game
positions, with switchable layers (factory status, power, later belts and trains). Evidence:
- FRM gives every factory building `location { x, y, z, rotation }` (frm-getFactory.md:23-27; units
  not documented). In the 2026-09-22 capture, all 338 buildings have it; 333 sit exactly on a
  100-unit grid; rotations are mostly 0/90/180/270; the base spans about 264,000 x 141,500 units.
  That's consistent with Unreal centimetres (buildings snapping to 1 m). Corroborated (amendment
  2026-09-24) by SCIM's world bounds in the same game units and by community measurements
  (docs-vault/raw-sources/world-coordinates.md); the owner's in-game check is now a confirmation,
  not a blocker.
- The contract's FactoryBuilding has no location and no circuit group today (packages/shared/src/factory.ts).
- The base map image is the owner's decision (ADR-0014): community-map style, pluggable, served
  from our own assets.
- The frontend is a microkernel for the map only (ADR-0014/0016): a map core plus layer plug-ins.
- CSP stays strict (ADR-0016 item 8). Every library is proven with the Playwright CSP guard.

## Decision
1. **Contract (additive, optional per the deploy-skew rule):** FactoryBuilding gains
   `location?: { xM, yM, zM, rotationDeg }`. The backend normalizes centimetres to metres (ADR-0006)
   and rotation to 0-360. It also gains `circuitGroupId?: number` (-1 = unconnected; the B3 fix
   already maps this correctly in the adapter). No new endpoint: the map reuses the factory query
   (30 s poll, SSE later). Payload cost is about 60 bytes per building, fine at the measured
   ~5 KB gzip.
2. **Map library: Leaflet with CRS.Simple** (a flat, non-geographic coordinate system; the classic
   choice for game maps). It's mainstream, has a static CSS file, and sets styles via CSSOM.
   Buildings are drawn with its canvas renderer (circle or rotated-rect markers, not DOM icons),
   which stays smooth into the thousands of markers.
   - Rejected: MapLibre GL (WebGL tiles built for geographic maps; needs worker/blob CSP
     allowances; heavier); a fully custom canvas (we'd rebuild pan, zoom and tiles).
   - Gate: a spike proves zero CSP violations (pan, zoom, marker hover, layer toggle) before it's adopted.
3. **Coordinate mapping, owned by the map core:** a base-map config
   `{ tilesUrlTemplate | imageUrl, worldBoundsM: { minX, maxX, minY, maxY }, yAxis: "down"|"up" }`
   maps world metres to map coordinates. The config is swappable, so a self-drawn map is a
   config change (ADR-0014 owner decision).
   - *Amendment 2026-09-24:* the mapped world is a 7,500 m square, `worldBoundsM = { minX: -3246.99,
     maxX: 4253.02, minY: -3750, maxY: 3750 }` (SCIM GameMap.js bounds in game units / 100; the
     community "5000 px at 1.5 m/px, origin at px (2163, 2500)" agrees to ~2 m). `yAxis: "down"`:
     +x = east, +y = south. In Leaflet CRS.Simple (lat grows north) the one projection function is
     `[lat, lng] = [-yM, xM]`. These are the grid base map's bounds; a future image base map carries
     its own bounds in its config. Only numbers are taken from SCIM, never its tiles or code.
     The quoted "7.97 x 6.8 km world" is a different extent and is not used.
   - Verification: a projection unit test (fixture building at xM -1957, yM -1056 lands north-west
     of the origin) plus one owner check on the spike: his factory appears where he knows it is.
4. **Base map asset:** a tile pyramid (not one huge image), generated offline from the chosen source
   image and served as our own static assets (Workers static assets, or R2 if file-count/size limits
   bite [NEEDS VERIFICATION: current Workers asset limits]). Never hotlinked. Until the image is
   settled, v1 ships with a neutral coordinate grid, and the map is fully functional without art.
5. **Layer plug-in contract (frontend, map core):**
   ```ts
   interface MapLayer<T> {
     id: string; label: string; defaultVisible: boolean;
     query: (serverId: string) => QueryOptions<T>;          // from the existing query layer
     draw: (ctx: MapContext, data: T) => () => void;        // returns cleanup
     legend: () => ReactNode;
     describe: (data: T) => ReactNode;                      // accessible text alternative
   }
   ```
   MapContext provides the Leaflet map, `project(xM, yM)`, a shared canvas renderer, and a
   selection/tooltip API. v1 layers:
   - (a) factory buildings: shape by building category, colour by state (producing %, paused,
     unconfigured, backed-up as a marker, not an alarm)
   - (b) power circuits: colour by circuitGroupId, outage highlighted
   Later: belts, trains, and power lines (FRM getBelts/getTrains, new contract, own ADR).
6. **Icons:** our own simple SVG glyphs per building category. No game art, per the LEGAL.md open item.
   The icon set is swappable.
7. **Accessibility:** the map canvas is paired with a list/table of visible buildings (filterable,
   same data) and per-layer text summaries (`describe`). Keyboard panning and zooming are on.
8. **Performance:** v1 draws every building. Trigger for clustering or level-of-detail: more than
   5,000 markers, or measured frame drops on a real save.
9. **Owners:** satisfactory-dash-dev (contract, backend normalization, cm verification);
   satisfactory-dash-frontend (map core, layers, base-map pipeline, spike).

## Sequence
1. Docs (this ADR).
2. Shared contract: optional location + circuitGroupId, fixtures with real captured coordinates.
3. Backend: cm -> m, rotation normalization, the verification test from the capture.
4. Frontend spike: Leaflet CRS.Simple + CSP guard + grid base map + the buildings layer.
5. Power-circuit layer.
6. Base map tiles + calibration, once the owner settles the image.

## Consequences
- The map works on any save with zero game art. Art is an isolated, swappable asset.
- A new runtime dependency (Leaflet), accepted at PR approval by the owner.

## Revisit when
- More than 5,000 markers or measured jank (level-of-detail/clustering).
- Non-factory structures are needed (new FRM endpoints and contract).
- Live movement (trains, vehicles) is needed: SSE push (ADR-0005/0020) instead of 30 s polling.
