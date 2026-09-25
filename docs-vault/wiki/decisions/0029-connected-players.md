# ADR-0029: Showing who is connected (player names), with minimal data

Status: accepted (project owner), 2026-09-24: decision 1 yes; decision 2 no (no "dead" marker, so the
adapter maps only `name` and `online`). The owner requested it (Players card, phase 2).

## Context
- The owner wants the Players card to eventually show who is connected. The vanilla API gives
  only counts (`NumConnectedPlayers` / `PlayerLimit`, raw-sources/dedicated-server-api.md:381-382).
  FRM's getPlayer returns per player: ID, Name, ClassName, world location, rotation, PlayerHP,
  Speed, Online, Dead and a full Inventory (raw-sources/frm-getPlayer.md:12-34).
- **Player names are personal data about third parties**: the people on the owner's game server
  aren't users of this service and never agreed to our privacy policy. The privacy outline
  (docs-vault/wiki/legal/privacy-terms-outline.md) doesn't cover them yet.
- Server-scoped routes are already authorized per membership (ADR-0025 PR 6), so a new route
  under `/api/servers/:serverId/` is members-only by construction and covered by the generated
  IDOR tests automatically.

## Decision
1. **Data minimization at the adapter:** the gameserver adapter maps FRM getPlayer to **only
   `name` and `online`** (no `dead` marker: owner decision 2). ID, location,
   HP, speed and inventory are dropped at the boundary and never enter the domain, contract,
   logs or storage.
2. **A separate endpoint**, `GET /api/servers/:serverId/players` → `{ available: boolean, players: { name, online }[] }`.
   - `available: false` when FRM isn't installed or reachable: the vanilla API has no player list,
     so the card falls back to phase 1's counts.
   - A separate endpoint, not a field on status: status stays count-only and cheap. Names are
     fetched only by the Players card, at the status polling cadence.
   - The contract is additive (a new endpoint and schemas), in its own PR first.
3. **Live only, never stored:** no table, no history of who was online when, no inclusion in
   ADR-0027's history or alerts. Like status, it's fetched live per request (there's no cache);
   the load is bounded by the frontend's polling cadence.
4. **Never logged:** a pino redact path for the players payload, plus a test that captures the
   log output of a players request and asserts no name appears.
5. **Visible to server members only** (the PR 6 middleware); the demo uses invented names.
6. **The privacy outline gets a row:** "In-game names of players connected to a server you're a
   member of: shown live to that server's members; not stored or logged. They come from the
   server owner's own game server." Plus a note that the server owner is responsible for telling
   their players. `[LEGAL]` Add this to the pre-publication review list.

## Consequences
- The feature needs FRM. On vanilla-only servers the card keeps showing counts.
- No retention questions, because nothing is kept.
- A future "player history" or "show players on the live map" would need a new decision
  (storage, location data): it's not covered here.

## Build plan
| # | PR | Owner | Test-hunter |
|---|---|---|---|
| 1+2 | ONE PR: contract (`ServerPlayersResponse` + endpoint entry) together with the adapter (name/online only), route, redaction and the no-names-in-logs test. *Amendment (2026-09-24):* the IDOR tests generated from the endpoints list pick up a new server-scoped endpoint at once, so a contract-only PR can't pass CI without its authorized route. This is the intended safety property, not a workaround. | dev | FULL + security-reviewer |
| 3 | The Players card shows names; demo invented names | frontend | QUICK + ui-reviewer |
| 4 | The privacy outline row (docs) | dev | skip |

## Revisit when
- Someone asks for player history, positions on the map, or names in alerts: each is a new
  personal-data decision.

## Decisions for the owner
1. Build "who is connected" as specified (names plus online, live only, members only)? **Recommend yes.**
2. Show a "dead" marker next to a player (FRM `Dead`)? **Recommend no.** It's fun but not needed;
   less data is better.
