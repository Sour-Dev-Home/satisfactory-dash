Source: SatisfactoryModLoader's GitHub releases, https://github.com/satisfactorymodding/SatisfactoryModLoader/releases (read through the GitHub REST API, `GET /repos/satisfactorymodding/SatisfactoryModLoader/releases`), and ficsit.app's SML version list, https://api.ficsit.app/v2/query (GraphQL `getSMLVersions`, the data behind https://ficsit.app/sml-versions)
Captured: 2026-10-20
Method: `gh api` for the releases (tag, `published_at`, `html_url`, body); a POST of `{ getSMLVersions(filter: {limit: 20}) { sml_versions { version satisfactory_version stability date engine_version } } }` to the ficsit.app API. SML is GPL-3.0 (`sml-license-2026-09-27.txt`); only the lines this repo cites are kept, verbatim.
Why it is here: issue #472, the SML breakage history for `wiki/mod-maintenance.md` (ADR-0039 G3 readiness item 3). The game's side of the history is `satisfactory-patch-history-2026-10-20.md`.

## Findings

- Every SML release since 1.0 (3.8.0 to 3.12.0) and its publish date are in E1.
- Four releases state the game version they add support for: 3.8.0 (1.0, E10), 3.11.0 (1.1 Experimental, E6), 3.11.1 (1.1.0.5 Experimental, E5) and 3.12.0 (1.2, E2). Two of them say the previous game version no longer works with them (E5, E6).
- Two more update SML's headers to a newer game build without saying the update was required: 3.9.0 (CL383729, E9) and 3.11.2 (CL416835, E4).
- ficsit.app records each SML release's minimum game build (`satisfactory_version`, E11).

### E1 — Release list (tag, published_at, URL), 2024-01 to 2026-10-20

```
v3.12.0  2026-06-06T17:09:42Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.12.0
v3.11.3  2025-08-09T03:18:44Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.11.3
v3.11.2  2025-08-01T00:22:51Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.11.2
v3.11.1  2025-06-05T19:03:39Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.11.1
v3.11.0  2025-05-29T04:01:09Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.11.0
v3.10.0  2025-03-06T05:33:25Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.10.0
v3.9.1   2025-01-22T22:02:54Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.9.1
v3.9.0   2024-12-17T00:47:12Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.9.0
v3.8.0   2024-10-10T21:32:21Z  https://github.com/satisfactorymodding/SatisfactoryModLoader/releases/tag/v3.8.0
v3.7.0   2024-01-07          (previous release, before 1.0)
```

### E2 — v3.12.0 (2026-06-06)

```
* Satisfactory 1.2 (CL#491125) support
Mod developers, be sure to **read the guide we wrote to help you update your mods and modding environment!**
https://docs-dev.ficsit.app/satisfactory-modding/latest/Development/UpdatingFromSml311.html
  * Headers to CL491125
  * Stubs to CL491125
  * Gameplay Tags to CL491125
```

### E3 — v3.11.3 (2025-08-09)

```
* Fix bug causing multiplayer clients to sometimes see copies of their own chat messages instead of Chat Command responses (#384)
```

(No game-version line.)

### E4 — v3.11.2 (2025-08-01)

```
* Updated project:
	* Headers to CL416835 (#370)
```

### E5 — v3.11.1 (2025-06-05)

```
Note that SML 3.11.1 will only work on the latest 1.1 Experimental patch (game CL must be >= 415558) and not 1.0 due to changes in the base game's headers.
* Satisfactory v1.1.0.5 (Experimental) support
	* Headers to CL415558
```

### E6 — v3.11.0 (2025-05-29)

```
Note that SML 3.11 will only work on 1.1 (game CL must be >= 410840) and not 1.0 due to changes in the base game's headers.
* Satisfactory 1.1 (Experimental) support
Mod developers, be sure to **read the guide we wrote to help you update your mods and modding environment!**
https://docs.ficsit.app/satisfactory-modding/latest/Development/UpdatingFromSml310.html
	* Content stubs to CL404250
	* Headers to CL410840
```

### E7 — v3.10.0 (2025-03-06)

```
https://docs.ficsit.app/satisfactory-modding/latest/Development/UpdatingFromSml39.html
```

(The update-guide link; no game-version line.)

### E8 — v3.9.1 (2025-01-22)

```
* Fix Reliable Buffer Overflow caused by too many Mod Savegame Settings (Session Settings)
```

(No game-version line.)

### E9 — v3.9.0 (2024-12-17)

```
	* Content stubs to CL382498
	* Headers to CL383729
```

### E10 — v3.8.0 (2024-10-10)

```
* Satisfactory 1.0 release support
* Updated project to CL368883
* Add mod game version range
```

### E11 — ficsit.app SML versions (`satisfactory_version` is the minimum game build)

```
{"version":"3.12.0","satisfactory_version":491125,"stability":"release","date":"2026-06-06T17:02:02Z","engine_version":"5.2"}
{"version":"3.11.3","satisfactory_version":416835,"stability":"release","date":"2025-08-09T03:19:09Z","engine_version":"5.2"}
{"version":"3.11.2","satisfactory_version":416835,"stability":"release","date":"2025-08-01T00:23:27Z","engine_version":"5.2"}
{"version":"3.11.1","satisfactory_version":415558,"stability":"release","date":"2025-06-05T19:04:18Z","engine_version":"5.2"}
{"version":"3.11.0","satisfactory_version":410840,"stability":"release","date":"2025-05-29T04:01:59Z","engine_version":"5.2"}
{"version":"3.10.0","satisfactory_version":383729,"stability":"release","date":"2025-03-06T02:39:19Z","engine_version":"5.2"}
{"version":"3.9.1","satisfactory_version":383729,"stability":"release","date":"2025-01-22T22:03:28Z","engine_version":"5.2"}
{"version":"3.9.0","satisfactory_version":383729,"stability":"release","date":"2024-12-17T00:44:58Z","engine_version":"5.2"}
{"version":"3.8.0","satisfactory_version":365306,"stability":"release","date":"2024-10-10T21:32:54Z","engine_version":"5.2"}
{"version":"3.7.0","satisfactory_version":273254,"stability":"release","date":"2024-01-07T04:10:59Z","engine_version":"5.2"}
```
