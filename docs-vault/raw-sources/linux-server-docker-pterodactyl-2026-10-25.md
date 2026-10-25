Source:
- Satisfactory wiki, "Dedicated servers", https://satisfactory.wiki.gg/index.php?title=Dedicated_servers&oldid=62959 (revision 62959 of 2026-10-06T19:55:22Z, still the current one on the capture date)
- robtme/satisfactory-server README, https://github.com/robtme/satisfactory-server (main at commit 11e03a579e6bbbbfff7cfca3d479873df650d0fa, 2026-10-06T19:59:04Z; licence MIT per the GitHub API)
- Pterodactyl game-eggs, `satisfactory/egg-satisfactory.json`, https://github.com/pterodactyl/game-eggs (latest commit to that file 601c89177b04780d2b564c4f849e12b3d2bc3942, 2026-05-21T07:48:28Z; repository licence MIT per the GitHub API)
- ficsit.app GraphQL API, https://api.ficsit.app/v2/query (queried 2026-10-25)
Captured: 2026-10-25
Method: the wiki's wikitext through MediaWiki's raw action (revision id from `api.php?action=query&prop=revisions`); the README and the egg through `raw.githubusercontent.com` / the GitHub contents API; the mod targets from two GraphQL queries (`getModByReference(modReference: "FicsitRemoteMonitoring")` and `getSMLVersions`). Passages copied unedited.
Source kind: community (wiki, README, egg), and the mod portal's own API for the targets. None is Coffee Stain documentation.
Excerpts only: the wiki is CC BY-NC-SA 4.0 (see `dedicated-server-ports-2026-10-19.md`), so only quoted excerpts are kept. The README and egg are MIT; they are quoted, not copied whole.
Why it is here: ADR-0057 (hosting coverage): what a Linux dedicated server needs, how the common Docker image and the Pterodactyl egg start it, and whether SML and FRM ship Linux server builds.
FINDINGS (as the sources state them):
  - Linux and Windows server binaries exist; installed with SteamCMD, app 1690800; "There is no 32-bit (x86) or ARM support"; "a `kvm64` CPU won't work" on a VM (E1).
  - Memory 8 GB, 16 GB recommended for larger saves (E1). On Linux the server is started with `./FactoryServer.sh`; logging to the terminal and unattended mode are on by default there (E2).
  - A popular Docker image is robtme's; it publishes 7777/tcp, 7777/udp and 8888/tcp and says mod support "is still a little rough around the edges, but they do now work" (E3).
  - The Pterodactyl egg starts the Linux binary with a fixed command that passes `-Port` and `-ReliablePort`/`-ExternalReliablePort`; the panel offers only the variables the egg defines, and the container image is a SteamCMD Debian image (E4).
  - FRM 1.5.4 and SML 3.12.0 are published with a `LinuxServer` target on ficsit.app (E5).
NOT FOUND (recorded, not guessed):
  - How to run `server.GenerateAPIToken` (the console command for an application token, `dedicated-server-api.md` E5) on a Linux or Docker server: neither the wiki excerpt nor the README says. [NEEDS VERIFICATION], first rehearsal item.
  - Whether the robtme image publishes an arm64 variant (not stated; the game itself has no ARM support, E1).

### E1 — The wiki: requirements

```wikitext
Dedicated server binaries are available for 64bit [[wikipedia:Microsoft_Windows|Windows]] and [[wikipedia:Linux|Linux]] systems.
There is no 32-bit (x86) or ARM support.<br>
If this is a VM (a VPS most definitely is), a <code>kvm64</code> CPU '''won't''' work!
|'''Memory'''||8GB. 16GB RAM may be recommended for larger saves or to host more than 4 players.
|'''Operating System'''||Windows 10,11, Server 2016, Server 2019 or Server 2022, or a Linux distro like Debian or Ubuntu
steamcmd +force_install_dir ~/SatisfactoryDedicatedServer +login anonymous +app_update 1690800 validate +quit
A user without root privileges is recommended. If the SteamCMD wiki instructions were followed, the <code>steam</code> user may be used.
```

### E2 — The wiki: starting it on Linux

```wikitext
Navigate to the directory where the Satisfactory dedicated server is installed, and use the following command, with any other options from the below table that are needed:<syntaxhighlight>
./FactoryServer.sh
Forces the server to display logs in a window on Windows, or in the active terminal on Linux. This option is enabled by default when launching on Linux.
Makes it such that the Dedicated Server will not present any dialogs which might otherwise interrupt the server from running if not attended to. This option is enabled by default when launching on Linux.
```

### E3 — The robtme Docker image: ports, mods

```
--publish 7777:7777/tcp \
--publish 7777:7777/udp \
--publish 8888:8888/tcp \
robtme/satisfactory-server:latest
Mod support is still a little rough around the edges, but they do now work.
```

### E4 — The Pterodactyl egg: a fixed startup command, a Debian SteamCMD image

```
"startup": "./Engine/Binaries/Linux/*-Linux-Shipping FactoryGame -Port={{SERVER_PORT}} -ReliablePort={{RELIABLE_PORT}} -ExternalReliablePort={{RELIABLE_PORT}}",
"docker_images": { "ghcr.io/ptero-eggs/steamcmd:debian": "ghcr.io/ptero-eggs/steamcmd:debian" },
"env_variable": "RELIABLE_PORT", "default_value": "8888"
```

The egg lists its variables (auto-update, validate, max players, autosaves, timeouts, branch, reliable port); a mod's extra port such as FRM's is not one of them.

### E5 — ficsit.app: Linux server targets (GraphQL, 2026-10-25)

```
FicsitRemoteMonitoring 1.5.4 (created 2026-10-14T05:01:56Z, game_version ">=513885"): targets LinuxServer (9283704 bytes), Windows, WindowsServer
SML 3.12.0 (satisfactory_version 491125): targets Windows, WindowsServer, LinuxServer
```
