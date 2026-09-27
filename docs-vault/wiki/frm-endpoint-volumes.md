# FRM endpoint volumes and coverage (groundwork for #329 and #330)

Twelve FicsitRemoteMonitoring read endpoints captured from the live game server on 2026-09-27 over loopback
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

## Redaction (public repo)

The only field that had to be redacted was `SessionName` in `getSessionInfo` (the save name), replaced by
`"REDACTED-SAVE-NAME"`. None of the twelve responses contains a player name or id (those live in `getPlayer`, which was
not captured). Free-text labels typed by a player (train, station and map-marker names) were read in full and are plain
in-game labels, so they are kept. Object ids such as `Build_SpaceElevator_C_2147240253` are in-game instance ids, not
personal data. The large responses are committed as trimmed samples of unmodified items; the full sizes and item counts
are in each file's header and in the table above.
