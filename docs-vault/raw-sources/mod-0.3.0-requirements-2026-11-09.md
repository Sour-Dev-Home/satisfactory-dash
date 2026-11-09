Source:
- Sour-Dev-Home/satisfactory-dash-mod, https://github.com/Sour-Dev-Home/satisfactory-dash-mod (commit c909195f70b2204d96492eaaa8c28400d1df635f, 2026-11-09T22:18:32Z; public; licence GPL-3.0 per the GitHub API)
  - `mod/SatisDashAgent/SatisDashAgent.uplugin`
  - `docs/releases/0.3.0.md`
  - `docs/e2e-checklist.md`
Captured: 2026-11-09
Method: the GitHub contents API at that commit (`repos/Sour-Dev-Home/satisfactory-dash-mod/contents/<path>?ref=c909195`), base64-decoded. Passages copied unedited; line numbers are the file's own at that commit.
Source kind: first party (the Satis Manager mod's own repository: its plugin descriptor, its release notes, and its end-to-end test record of 2026-11-09 on a Linux dedicated server against production). Not Coffee Stain or SML documentation.
Excerpts only: the repository is GPL-3.0, so only quoted excerpts are kept.
Why it is here: the setup guides (`frontend/content/guides/setting-up-from-scratch.md`, `connecting-a-server.md`) state what mod 0.3.0 needs on the server and on players' games, and what pairing looks like in practice.
FINDINGS (as the sources state them):
  - The mod depends on SML `^3.12.0` and nothing else (E1 line 26; E2 line 8).
  - The mod is not required on clients: `RequiredOnRemote` is `false` (E1 line 18; E2 lines 13-15).
  - Players need SML: a server with SML refused a vanilla client with "cannot connect a modded server to a vanilla client", observed 2026-11-09 (E2 line 13; E3 lines 55-57, 127).
  - On a Linux container the console lagged minutes behind `FactoryGame.log`; read the code in the log there (E3 lines 131-133).
  - The chat code can't be copied, so it is typed (E3 line 128).
  - After pairing onto an existing dashboard server, the map showed the previous layers for up to about 9 minutes; Power and Factory were live within a minute (E3 lines 65-73, 134-136).

### E1 — `mod/SatisDashAgent/SatisDashAgent.uplugin`, lines 4-5, 18, 25-27

```
4	"VersionName": "0.3.0",
5	"SemVersion": "0.3.0",
18	"RequiredOnRemote": false,
25	"Plugins": [
26		{ "Name": "SML", "Enabled": true, "SemVersion": "^3.12.0" }
27	]
```

### E2 — `docs/releases/0.3.0.md`, lines 8-15

```
8	You need **SML 3.12.0 or later (3.x)** on the server; the mod has no other dependency.
9	
10	Where to get SML: the Satisfactory Mod Manager (SMM) installs it for you. For a manual install, take it from SML's page
11	on ficsit.app (https://ficsit.app/mod/SML).
12	
13	**Players need SML too.** A server with SML refuses game clients that don't have it ("cannot connect a modded server to
14	a vanilla client"), so everyone who joins needs SML installed, for example through SMM. They don't need this mod: it
15	runs on the server only.
```

### E3 — `docs/e2e-checklist.md`, lines 55-57, 65-73, 126-136

```
55	- [ ] **One player:** with the code still open (or after restarting the server), join alone with the game client. The
56	      `Pairing code` line appears in the in-game chat, and a client with SML only (no SatisDashAgent) renders it. A
57	      vanilla client can't join: a server with SML refuses it ("cannot connect a modded server to a vanilla client").
```

```
65	Within a minute of enrolling:
66	- [ ] **Status:** online, players, game phase/tick; the status updates while you watch (a snapshot every 5 s).
67	- [ ] **Power:** circuits, generators with fuel, consumption that changes when you build or toggle something.
68	- [ ] **Players:** join with the game client; you appear, and your position moves on the map.
69	- [ ] **Factory:** machines, production rates, extractors, storage contents.
70	- [ ] **Trains and stations:** positions, timetable stops, cargo, transfer rates (use a save that has trains).
71	
72	About 8 minutes after start (then every 10 or 30 minutes, and only when something changed):
73	- [ ] **Map layers:** rails, conveyors (belts, lifts, pipes), power lines, map markers, drone routes, resource nodes.
```

```
126	**Findings.**
127	1. **Players need SML on their game client.** A server with SML refuses a vanilla client. The release notes now say so.
128	2. **The chat code can't be copied.** Satisfactory's chat text isn't selectable, so the code has to be typed. The four
129	   codes seen used only `A-Z` and `2-7`, so there's no `0`/`O` or `1`/`I` to confuse, but this wasn't checked in the
130	   backend.
131	3. **The container console lags.** `docker logs` stopped at 21:09:25 while `FactoryGame.log` went on; the `Pairing code`
132	   line reached the console only minutes later. The game's stdout looks block-buffered under Docker. Read the code
133	   in `FactoryGame.log` on Linux containers.
134	4. **The map shows the previous server's layers for up to about 9 minutes** after pairing onto an existing dashboard
135	   server. Power and Factory are live within a minute, but the map layers are first read 2 (rails) and about 8 minutes
136	   (the rest) after start, and the backend keeps its last copy until then. They were replaced on schedule.
```
