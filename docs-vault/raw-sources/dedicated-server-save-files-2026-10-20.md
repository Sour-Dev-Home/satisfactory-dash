Source: https://satisfactory.wiki.gg/index.php?title=Dedicated_servers&oldid=62959 (revision 62959 of 2026-10-06T19:55:22Z, the current one on the capture date; the same revision `dedicated-server-ports-2026-10-19.md` quotes)
Captured: 2026-10-20T00:23:38Z
Method: the page's wikitext through MediaWiki's raw action (`https://satisfactory.wiki.gg/wiki/Dedicated_servers?action=raw`), the revision ID from the site's API (`api.php?action=query&prop=revisions`); passages copied unedited from the wikitext, so markup such as `<code>` and `[[links]]` appears as in the source.
Source kind: **community.** satisfactory.wiki.gg is a community-edited wiki, not Coffee Stain documentation. The official API document names no save or settings path (`dedicated-server-api-saves-2026-10-20.md`, NOT FOUND), so the paths below rest on this wiki alone. Its settings-file table cites a Discord message (an HTML comment in E3) that was not captured.
Excerpts only: the wiki's content licence is CC BY-NC-SA 4.0 (the site's `rightsinfo`). Its non-commercial and share-alike terms do not fit this AGPL-3.0-only repository with monetisation undecided, so only quoted excerpts are kept, with this attribution; the full page stays at the pinned URL.
Item: ADR-0039 G0 addendum 2 (#462): where a Windows dedicated server keeps its saves and settings, whether that depends on the account running it, and how to make it load a given save (spikes S3 and S5).
FINDINGS (as the wiki states them):
  - Save files, Windows: `%LocalAppData%\FactoryGame\Saved\SaveGames\server` when run as a user; `%WINDIR%\System32\config\systemprofile\AppData\Local\FactoryGame\Saved\SaveGames\server` under NSSM; `%WINDIR%\ServiceProfiles\NetworkService\AppData\Local\FactoryGame\Saved\SaveGames\server` as a Windows Server service (E4). The folder is under the running account's local app data, so it **depends on the account** running the server (E3, E4).
  - Server settings file, Windows: `ServerSettings.PORT.sav` in the same accounts' `...\FactoryGame\Saved\SaveGames\` folder, where `PORT` is the server's port (E3); it holds the server name, player password, auto-load session name and certificate (E6).
  - It is not where the configuration (ini) files are (E3).
  - Loading a save: upload it from the game through the Server Manager's "Manage Saves" tab (E1); the "Auto-Load Session Name" setting names the session whose most recent save loads on startup (E2).
  - The command-line options table has no option that loads a save (E5).
NOT FOUND (recorded, not guessed):
  - A launch argument or ini setting that loads a given save: neither the options table (E5) nor the page's other sections name one. `-ini:` (E5) sets an arbitrary ini value, but the page names no save-loading key for it.
  - A file placement rule (whether a `.sav` copied into the save folder by hand is picked up, and under what name): the page does not say.
  - Any official Coffee Stain statement of these paths.
---

### E1 — Loading a save file (line 364)

```wikitext
=== Loading a save file ===
Local saves can be uploaded from the game to a server through the "Manage Saves" tab of a server in the Server Manager.
```

### E2 — Server settings: the Auto-Load Session Name row (lines 327-341)

```wikitext
=== Server settings ===
When logged in as Admin via the ingame Server Manager, there are various server settings available.

{| class="wikitable"
|+style="text-align:left"|Dedicated Server
|-
! Setting !! In-game Description !! Notes
...
| Auto-Load Session Name || Name of the session the Dedicated Server should automatically load the most recent save of on startup ||
```

(`...` marks rows left out.)

### E3 — Server settings file locations (lines 400-415)

```wikitext
== Server file Locations ==
=== Server settings file ===
This is ''not'' the location of configuration files. See [[Dedicated_servers/Configuration_files]] for that.
<!-- https://discord.com/channels/370472939054956546/902621736602861588/1294799221655863326 -->
{| class="wikitable"
|-
! Platform !! Filepath !! Notes
|-
| Linux || <code>~/.config/Epic/FactoryGame/Saved/SaveGames/ServerSettings.PORT.sav</code>||rowspan="4"|<code>PORT</code> is the port the server is configured to run on. See [[Save_files#Dedicated_Server_Settings_File|Dedicated Server Settings File]]
|-
| Windows (user) || <code>%LocalAppData%\FactoryGame\Saved\SaveGames\ServerSettings.PORT.sav</code>
|-
| Windows (NSSM) || <code>%WINDIR%\System32\config\systemprofile\AppData\Local\FactoryGame\Saved\SaveGames\ServerSettings.PORT.sav</code>
|-
| Windows Server (Service) || <code>%WINDIR%\ServiceProfiles\NetworkService\AppData\Local\FactoryGame\Saved\SaveGames\ServerSettings.PORT.sav</code>
|}
```

### E4 — Save file locations (lines 417-429)

```wikitext
=== Save files ===
{| class="wikitable"
|-
! Platform !! Path
|-
| Linux || <code>~/.config/Epic/FactoryGame/Saved/SaveGames/server</code>
|-
| Windows (user) || <code>%LocalAppData%\FactoryGame\Saved\SaveGames\server</code>
|-
| Windows (NSSM) || <code>%WINDIR%\System32\config\systemprofile\AppData\Local\FactoryGame\Saved\SaveGames\server</code>
|-
| Windows Server (Service) || <code>%WINDIR%\ServiceProfiles\NetworkService\AppData\Local\FactoryGame\Saved\SaveGames\server</code>
|}
```

### E5 — Command line options: the whole table (lines 243-277)

```wikitext
=== Command line options ===
The below table outlines the available options for use when starting the server, either from the command-line or through Steam (via editing the Properties of the Dedicated Server's entry in Tools):

{| class="wikitable"
!style="width:25%"|Option !! Description
|-
|<code>-Port=<portnum></code>
|Override the port the server uses. The default port is 7777 (UDP and TCP). If the specified port is in use, the server will increment the port number and continue trying port numbers until an available one is found. 
|-
|<code>-ReliablePort=<portnum></code>
|Override the reliable messaging port the server uses. The default port is 8888 (TCP). If the specified port is in use, the server will fail to initialize.
|-
|<code>-ExternalReliablePort=<portnum></code>
|Use with the <code>-ReliablePort</code> option if external port remapping is used.
|-
|<code>-DisablePacketRouting</code>
|Startup argument for disabling the packet router (Automatically disabled with multihome).
|-
|<code>-DisableSeasonalEvents</code>
|Disables all seasonal events, such as [[FICSMAS]].
|-
|<code>-ini:<INIFILE>:[&lt;SECTION>]:<KEY>=<VALUE></code>
|Run with an ini configuration value, e.g, <code>-ini:Game:[/Script/Engine.GameSession]:MaxPlayers=8</code>
|-
!colspan="2" style="text-align: left"|Windows-only
|-
|<code>-Log</code>
|Forces the server to display logs in a window on Windows, or in the active terminal on Linux. This option is enabled by default when launching on Linux.
|-
|<code>-NewConsole</code>
|Run using the Satisfactory 1.0 Unreal console.<ref name="yt-v8piXNQwcUw@327">[https://www.youtube.com/watch?v=v8piXNQwcUw&t=327s YouTube - Dedicated Servers have LEVELED UP! - Unreal Console]</ref>
|-
|<code>-Unattended</code>
|Makes it such that the Dedicated Server will not present any dialogs which might otherwise interrupt the server from running if not attended to. This option is enabled by default when launching on Linux.
|}
```

### E6 — What deleting the settings file resets (line 625)

```wikitext
Delete the <code>ServerSettings.PORT.sav</code> file, where <code>PORT</code> is the server port number (e.g. <code>ServerSettings.7777.sav</code>), which can be found just above the server savegame directory. Please note that doing this will also reset the server name, player password, auto load session name, and certificate. The next time the server is started, it can be claimed as a new server, and a new administrator password can be set.
```
