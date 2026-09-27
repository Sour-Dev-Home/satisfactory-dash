# ADR-0038: The map's base image and overlay layers: data volume, cadence and caching

Status: accepted (owner, 2026-09-27) for card #330: D1 a data-derived base map now, plus a written permission
request to Coffee Stain; D2 ADR-0029 stays, so no player positions; D3 world cadence 10 min (30 min for game-thread
reads), sent only when the data changed.

## Context
- **The map core exists** (ADR-0023): Leaflet with `CRS.Simple`, one canvas renderer, a grid base,
  and a layer plug-in contract (`frontend/src/map/layers.ts:24-33`). The contract's own comment says
  that a layer with its own data "adds a query to this contract when it arrives".
- **The CSP** allows images from `'self'` only (`frontend/public/_headers`), so a base image has to be
  self-hosted. That means redistributing it, from a public AGPL repository.
- **Base image licence:** no public fan-content or asset-use policy from Coffee Stain was found. The
  press page offers a press kit "for press", with no stated terms (satisfactorygame.com/press). The
  game's map art is Coffee Stain's asset. [NEEDS VERIFICATION: written permission, or a stated policy.]
- **Measured volumes** (`docs-vault/wiki/frm-endpoint-volumes.md`, #334; one 77-day save):
  - Three large responses:
    - `getResourceNode`: 608 items, 288 KB, runs on the game thread.
    - `getTrainRails`: 65 segments, 279 KB.
    - `getSchematics`: 839 KB, runs on the game thread, and isn't a map layer.
  - Everything else captured is under 12 KB.
  - Not captured yet: belts, pipes, cables, vehicle paths, wells, geysers, and the shapes of drones
    and vehicles. Belts and pipes are likely the largest by far on a big factory.
- **Agent limits today:**
  - Snapshot body cap of 5 MB (`backend/src/modules/agents/config.ts:10`), gzip accepted.
  - Cadences of 5 s (status/power) and 30 s (factory), bounded by the schema at 1-3600 s
    (`packages/shared/src/agent.ts:42-44`).
- **Privacy:** ADR-0029 deliberately drops player location (it keeps name and online only).

## Decision

### 1. Two data tiers, by how often the data changes
| Tier | Layers | Read cadence | Transport | Cap (after field projection) |
|---|---|---|---|---|
| **Live** (small, moving) | trains, train stations' state, vehicles, drones | 30 s (the factory cadence) | a new optional `mapLive` part of the existing snapshot (agent) / the existing poller (local) | ≤ 500 items per kind, ≤ 256 KB total |
| **World** (large, rarely changes) | rails, resource nodes, wells and geysers, map markers, power lines, belts and pipes, vehicle paths | every 10 min, jittered; game-thread endpoints every 30 min | the agent reads it, hashes the projected result, and POSTs `/api/agent/world/:layer` **only when the hash changed** (and once after start). Local servers use the same schedule in the poller | per layer, 2 MB raw (gzip on the wire). Over the cap: send `{ truncated: true, count }`, and the UI says "too large to draw" |

- **Game-thread safety.** Endpoints the FRM docs mark as game-thread (`getResourceNode` among them)
  are never read at the snapshot cadence. The first real-server run compares the tick-rate card
  before and after, and that comparison decides whether 30 min is safe.
  [NEEDS VERIFICATION on the real server.]
- **Field projection lives in `packages/game-adapter`**, shared by the poller and the agent, as the
  existing mappers are. Each layer keeps only what it draws:
  - rails and paths: polylines, with coordinates rounded to whole metres;
  - nodes: `{type, purity, x, y, exploited}`;
  - markers: `{name ≤ 60 chars, icon, x, y}`.
  - Classification stays in the backend (ADR-0031 rule). Projection and rounding aren't
    classification.
- **Every layer's fields are captured into `raw-sources/` before its schema is written** (the
  citation rule). A layer with no capture isn't built.

### 2. Storage and serving
- **Latest only, no history** (history of positions: not now). Storage is
  `map.world_layers(server_id, layer, hash, observed_at, truncated, data jsonb)`, one row per server
  and layer, upserted when it changes. Live data sits beside the latest snapshot, as the other
  parts do.
- **Endpoints, members only (as every server route is):**
  - `GET /api/servers/:id/map/live`, polled every 10 s while the map is open.
  - `GET /api/servers/:id/map/world/:layer`, with `ETag` = the content hash and
    `Cache-Control: private, no-cache`. The browser revalidates with `If-None-Match` and usually
    gets 304 with no body.
- **The frontend fetches a world layer only when its toggle is on** (the query is enabled by
  visibility). Every layer stays its own lazy module under `frontend/src/map/`.
- **The contract:** shared zod schemas per layer, with `.max()` caps, in their own PR before the
  implementations (the workspace contract rule). `mapLive` is optional in the snapshot schema, so
  older agents stay valid.

### 3. The base map (Stage 1): no Coffee Stain image without permission (D1)
- **Recommended now:** a *data-derived* base.
  - It keeps the existing grid.
  - It uses the world bounds from `raw-sources/world-coordinates.md`.
  - Resource nodes, rails and markers serve as landmarks.
  - No third-party asset, so the licence question and the CSP question both disappear.
- **In parallel (owner):** ask Coffee Stain in writing for permission to self-host a map image in
  an AGPL fan tool, naming the use (a background under the owner's own dashboard, with credit). If
  permission comes, add the image as a separate, credited asset with its licence recorded in
  `LEGAL.md`, in its own PR.
- **Not acceptable:** extracting tiles from the game files or copying a community map without its
  author's licence.

### 4. Build order (each its own PR, smallest first)
| # | What | Owner |
|---|---|---|
| 1 | This ADR (docs) | dev |
| 2 | Capture the missing endpoints into raw-sources (belts, pipes, cables, vehicle paths, wells, geysers; drones and vehicles on a world that has some) | dev |
| 3 | Contract: `mapLive` + world-layer schemas with caps | dev |
| 4 | Backend: `map.world_layers`, agent world ingest (hashed, capped), the poller path, the two GET routes with ETag | dev |
| 5 | Agent: the world reader (slow, jittered, send only on change) + `mapLive` | dev |
| 6 | Frontend layers, one PR each: rails + trains → nodes/wells/geysers → markers → vehicles/drones → power lines → belts/pipes (largest last) | frontend |
| 7 | Data-derived base styling (Stage 1), or the licensed image if D1 comes back yes | frontend |

## Consequences
- The big lists cross the wire only when they change: a 280 KB rails layer costs its bytes once
  per change, not every 30 s. The browser pays for a layer only when the owner turns it on.
- Adding a layer means a capture, a schema, a mapper and a lazy frontend module. The core
  doesn't change.
- No history of world data, so "what did the rail network look like last week" isn't answerable.

## Revisit when
- A world layer's measured size nears its 2 MB cap on the owner's save: simplify geometry in the
  mapper (e.g. Douglas-Peucker at about 2 m) or tile it.
- Someone asks for movement history (trains, vehicles): a separate, retained table with a rollup.
- The tick-rate check shows a hiccup at 30 min: lengthen the cadence, or read only on demand.

## Owner decisions (2026-09-27)
- **D1** Base map: build it from data now (§3), and in parallel send Coffee Stain a written permission request.
- **D2** No players layer: ADR-0029 stays, so no in-game player position is kept.
- **D3** World cadence: 10 min (game-thread endpoints 30 min), sent only when the data changed.
