# FRM endpoint volumes and coverage (groundwork for #329 and #330)

Thirteen FicsitRemoteMonitoring read endpoints captured from the live game server on 2026-09-27 over loopback
(`GET http://127.0.0.1:8080/<endpoint>`, no token needed), for the Players card (#329) and the map overlays (#330).
The captures are in `docs-vault/raw-sources/captured-responses/frm-<endpoint>-2026-09-27-*.json`; each file's header
gives its method, the full size and item count, and what was redacted. This page answers, per endpoint: how big is the
response, how many items, and is it already covered by the vanilla API or by the agent's current snapshot. It feeds the
architect's data-volume pass on #330.

**How to read the numbers.** One save (77 in-game days), one moment. Sizes and counts scale with the factory and the map,
so read them as an order of magnitude, not a bound. "Game thread" is the column of the FRM docs table
(`raw-sources/frm-read-api.md`): `Yes` means the request runs on the game's main thread and can cause a hiccup on a big
save (`raw-sources/frm-dedicated-server.md`).

## Per endpoint

| Endpoint | Game thread (docs) | Items | Full size | Committed sample | Vanilla API | Agent snapshot today |
| --- | --- | ---: | ---: | --- | --- | --- |
| `getSessionInfo` | Yes | 1 object | 353 B | full (save name redacted) | No: `QueryServerState` has server state, not the session clock | **Yes**: `status` (`sessionName`, day, pause) |
| `getPlayer` | Yes | 1 | 3.6 KB | full (name and id redacted) | No: `QueryServerState` only counts players | **Partly**: `players` carries `name` and `online` only (ADR-0029); see the section below |
| `getProdStats` | No | 49 | 11.4 KB | full | No | No (production is derived per building from `getFactory`, not this global list) |
| `getResourceSink` | No | 1 | 306 B | full | No | No |
| `getSpaceElevator` | No | 1 | 1.0 KB | full | No | No |
| `getSchematics` | **Yes** | 574 | **838.6 KB** | 9 items | No | No |
| `getTrains` | No | 1 | 1.4 KB | full | No | No |
| `getTrainRails` | No | 65 | **278.9 KB** | 2 items (shortest and longest) | No | No |
| `getTrainStation` | No | 2 | 4.4 KB | full | No | No |
| `getMapMarkers` | No | 4 | 1.0 KB | full | No | No |
| `getResourceNode` | **Yes** | 608 | **288.2 KB** | 14 items (one per type combination) | No | No |
| `getDrone` | **Yes** | 0 | 2 B (`[]`) | empty | No | No |
| `getVehicles` | No | 0 | 2 B (`[]`) | empty | No | No |

- **Vanilla API:** the vanilla function list (`raw-sources/dedicated-server-api.md`, "API Functions") is server management
  (state, options, saves, claim, commands); none of it returns factory, world or train data.
- **Agent snapshot today:** `SnapshotRequestSchema` (`packages/shared/src/agent.ts`) carries `status`, `power`, `factory`,
  `players` and `settings.autoPause`; the game adapter reads only `getFactory`, `getPower`, `getPowerUsage`, `getPlayer`
  and `getSessionInfo` from FRM (`packages/game-adapter/src/satisfactoryServerAdapter.ts`). Everything else in this table
  would be a new read and, for the agent, a new part in the snapshot (a contract change).

## What stands out for the data-volume pass

- **Three responses are large**: `getSchematics` (838.6 KB, 574 items), `getResourceNode` (288.2 KB, 608) and
  `getTrainRails` (278.9 KB, 65 segments of 17 to 127 spline points each). Together about 1.4 MB, against 0.3 to 11 KB for
  the other nine.
- **Two of the three run on the game thread** (`getSchematics`, `getResourceNode`, per the docs table), so polling them at
  the snapshot cadence is the risky choice; the third, `getTrainRails`, does not.
- **What changes over time is inference, not measured here**: schematics, resource nodes and rails look like data that
  changes rarely (a schematic gets purchased, a node gets exploited, a track gets built). In this capture 31 of 608 nodes
  were `Exploited: true`. If a one-time or on-change read is enough, the cost is small [NEEDS VERIFICATION: how often
  each list really changes, and whether FRM offers a cheaper "changed since" read; the docs in `raw-sources/` list none].
- **Small responses are cheap to poll** (`getTrains`, `getTrainStation`, `getMapMarkers`, `getSpaceElevator`,
  `getResourceSink`, `getProdStats`): all under 12 KB here. Train and station data grows with the number of trains and cars
  (this world has one train with three cars).
- **Empty here, shape unknown**: `getDrone` and `getVehicles` returned `[]` because this world has no drones or vehicles;
  their item shape is not captured [NEEDS VERIFICATION: capture them on a world that has some before designing for them].
- `getProdStats` only contained the `Solid` type in this capture (49 items); whether fluids and gases appear there is not
  shown [NEEDS VERIFICATION].

## Map layer captures (#355, ADR-0038 capture cards)

Five more endpoints, captured from the same live server on 2026-09-27 at 19:23 UTC (the save was then 82 in-game days
old), the same way: `GET http://127.0.0.1:8080/<endpoint>` over loopback, no token. Files:
`raw-sources/captured-responses/frm-<endpoint>-2026-09-27-{trimmed,empty}.json`, each header giving the full size and
count and how the sample was chosen. Nothing needed redacting: none of the five responses contains a player name, player
id or save name (checked mechanically against the session name and the player list).

| Card | Endpoint | Game thread (docs) | Items | Full size | Committed sample | Projected, whole-metre x/y (estimate) |
| --- | --- | --- | ---: | ---: | --- | ---: |
| CAP-1 | `getBelts` | No | 1987 | **3.27 MB** | 4 items (shortest and longest spline, one per belt tier) | about 412 KB |
| CAP-1 | `getPipes` | No | 156 | 251.4 KB | 2 items (shortest and longest spline) | about 29 KB |
| CAP-2 | `getCables` | No | 843 | 576.7 KB | 2 items (shortest and longest line) | about 23 KB |
| CAP-3 | `getResourceWell` | **Yes** | 118 | 56.0 KB | 9 items (one per resource, purity, node type and exploited combination) | small |
| CAP-3 | `getResourceGeyser` | **Yes** | 0 | 2 B (`[]`) | empty | n/a |
| CAP-4 | `getVehiclePaths`, `getTruckStation`, `getVehicles`, `getDrone`, `getDroneStation` | | | | **not captured**: waiting on the owner | |

The last column is a rough size for a layer that keeps only whole-metre x/y points per segment, as ADR-0038's rails
mapper does: the JSON of `[[x, y], ...]` per belt or pipe spline, and of the two end points per power line. It is an
estimate made from these captures, not the mapper's real output.

- **`getBelts` alone is over the 2 MB per-layer cap as FRM sends it**: 1987 segments, 31,953 spline points, 3.27 MB raw.
  Most of that is per-segment baggage (`BoundingBox`, `ColorSlot`, `features`, z and floats). Projected as above it is
  about 412 KB, within the cap, but it grows with the factory: this is a mid-size save. The belt tiers carry their speed
  in `ItemsPerMinute` (Mk.1 60, Mk.2 120, Mk.3 270, Mk.4 480); 1944 of 1987 segments are connected at both ends.
- **`getPipes`** has the same shape as belts with `Speed` instead of `ItemsPerMinute`; every segment here was
  `Pipeline Mk.1` with `Speed` 5 [NEEDS VERIFICATION: what `Speed` measures, and its value on a Mk.2 pipeline].
- **`getCables` has no spline**: each power line is its two end points (`location0`, `location1`) and a `Length` in
  centimetres (2 m to 257 m here). So the layer is straight segments.
- **`getResourceWell` lists fracking satellites only**: all 118 are `NodeType: "Fracking Satellite"` and
  `Exploited: false` on this save, so the capture shows neither a well core (the pressurizer's node) nor a tapped
  satellite [NEEDS VERIFICATION: capture again once a resource well pressurizer is built]. Each item has `Purity`,
  `EnumPurity`, `ResourceForm` and `location`, like `getResourceNode`, so it can extend the nodes layer.
- **`getResourceGeyser` answered `[]`** although the world has geysers [NEEDS VERIFICATION: whether FRM lists only
  geysers with a geothermal generator on them, or none on this version]. The layer can't be designed from this capture.
- **Resolved (ADR-0038 M2, #353, architect follow-up on #367):** `getResourceGeyser`'s empty capture is explained —
  geysers arrive through `getResourceNode` too, with `NodeType: "Geyser"` (the trimmed 14-item sample in
  `frm-getResourceNode-2026-09-27-trimmed.json` never happened to include one, only `Node` and `Fracking Satellite`).
  The `resourceNodes` map layer already covers geysers through this one endpoint; no separate geyser layer or
  capture is needed.
- **Both resource endpoints run on the game thread** (the docs' index), like `getResourceNode`, so they belong with the
  rarely read, on-change data, not the snapshot cadence.
- **CAP-4 waits on the owner**: vehicles, vehicle paths, truck stations, drones and drone stations need one of each built
  in-game first (this world has none; `getDrone` and `getVehicles` were `[]` in the first capture too).

## `getPlayer` and `getSessionInfo`: what the captures show (for #329 option C)

Both captures are one sample from one world (one known player, offline), so each answer says what was seen and what was
not. The FRM docs describe these fields only in a line each (`raw-sources/frm-getPlayer.md`) and, for `getSessionInfo`,
the descriptions of `DayLength`, `NightLength`, `PassedDays`, `Hours`, `Minutes`, `Seconds` and `IsDay` are all the
copy-pasted "Save Name currently running" (`raw-sources/frm-getSessionInfo.md`), so they say nothing about units.

- **Offline players do appear, with `Online: false`.** The one player this server knows was returned with
  `Online: false` and nobody connected (the list is not "connected players only"). Not shown: whether the list keeps every
  player who ever joined, or only those in the save [NEEDS VERIFICATION with a second player].
- **`PlayerHP`: only `100` was seen** (a `Float`; the player was offline and `Dead: false`). No range is established:
  whether 100 is the maximum, and what a damaged or dead player reports, needs a connected player
  [NEEDS VERIFICATION].
- **`Speed` is sent**: the key is present in the response, a number, `0` here (offline). Its value while moving and its
  unit are not shown, and the docs give no unit ("Speed of the Player") [NEEDS VERIFICATION].
- **Everything else in the response**: `ID` (the player's object id, `Char_Player_C_<digits>`), `Name`, `ClassName`
  (`Char_Player_C`), `location` (`x`, `y`, `z`, `rotation`, `pitch`; the player was offline, so presumably the last known position), `Dead`, the
  whole `Inventory` (39 stacks, each `Name`, `ClassName`, `Amount`, `MaxAmount`) and a `features` block repeating the name
  and position. That is 3.6 KB for one player, mostly the inventory, so the size grows with the number of players and
  their inventories. **The current contract carries only `name` and `online`** (`packages/shared/src/players.ts`, ADR-0029:
  "no ID, location, health, inventory or dead marker", because player names are personal data about people who are not
  users of this service); anything beyond that for #329 option C is a contract and privacy decision, not just a read.
- **`getSessionInfo` units, derived from the capture (the docs do not say):**
  - `TotalPlayDuration` is **seconds**: `276096` and `TotalPlayDurationText` `"76:41:36"` are the same duration (docs:
    "Duration in Seconds").
  - `Hours`, `Minutes`, `Seconds` are the **in-game clock** (time of day, here 11:28:30.9, with `IsDay: true`), not play time.
  - `PassedDays` counts in-game days (77 here); whether the current, unfinished day is included is not shown (the
    arithmetic below works with it counted separately).
  - `DayLength: 50` and `NightLength: 10` look like **real-time minutes** per in-game day and night: they add up to 60
    minutes, and 77 passed days plus the 11:28 of the current day is about 77.5 in-game days, which at 60 real minutes each
    is about 77.5 hours, against 76.7 hours (276096 s) of `TotalPlayDuration`, within about 1%. Consistent with minutes,
    not proven [NEEDS VERIFICATION against the game's own day-length setting].

## Redaction (public repo)

- **`getSessionInfo`**: `SessionName` (the save name) is replaced by `"REDACTED-SAVE-NAME"`.
- **`getPlayer`**: `Name` and `features.properties.name` (the player name) are replaced by `"REDACTED-PLAYER-NAME"` and
  `ID` (the player's object id) by `"Char_Player_C_REDACTED"`. Everything else is as returned (location, HP, Speed,
  Online, Dead, the inventory).
- **The other eleven responses** contain no player name or id. Free-text labels typed by a player (train, station and
  map-marker names) were read in full and are plain in-game labels, so they are kept. Object ids such as
  `Build_SpaceElevator_C_2147240253` are in-game instance ids, not personal data.
- **Checked mechanically**: the real player name, the real player id and the real save name were searched
  (case-insensitively) in all 1116 files of the working tree outside `node_modules`: 0 hits.
- The large responses are committed as trimmed samples of unmodified items; the full sizes and item counts are in each
  file's header and in the table above.
