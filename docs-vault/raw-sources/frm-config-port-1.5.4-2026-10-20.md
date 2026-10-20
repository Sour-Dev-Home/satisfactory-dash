Source: https://github.com/porisius/FicsitRemoteMonitoring/blob/b4a712b6c1e3bb7ba7aff7f8a6a927c6b590e315/docs/modules/ROOT/pages/config/current/config.adoc (tag `1.5.4-515`, commit b4a712b6c1e3bb7ba7aff7f8a6a927c6b590e315, released 2026-10-16T17:26:00Z). The repository has a second 1.5.4 tag, `1.5.4-510` (commit 9e5f5420fbab1b938f5ba79f0e33449f2a765b60, released 2026-10-14T05:22:43Z); the page is byte-identical at both.
Captured: 2026-10-20T00:24:19Z
Method: the raw file at each commit through `raw.githubusercontent.com`, the tags and release dates from the GitHub API (`/repos/porisius/FicsitRemoteMonitoring/tags` and `/releases`), the two copies compared with `cmp`; passages copied unedited from the AsciiDoc source.
Source kind: FRM's own documentation, in its repository (the page `frm-config.md` captured from docs.ficsit.app "latest" on 2026-09-21, now pinned to the 1.5.4 tag).
Excerpts only: FRM carries no licence (`frm-license-status-2026-09-27.md`), so only quoted excerpts are kept; the full page stays at the pinned URL. None of FRM's code is read or reused.
Item: ADR-0039 G0 addendum 2 (#462): FRM 1.5.4's documented setting for its web server's port (spike S3 runs FRM beside the mod on the test server).
FINDINGS (as the page states them):
  - The setting is the key `<prefix>.uWS.Port`, type `mStringValue`, "Web Server Port", "TCP Port for Web Server, Default: 8080" (E3).
  - The prefix on a dedicated server is `FicsitRemoteMonitoring.Server`, so the key there is `FicsitRemoteMonitoring.Server.uWS.Port`; single player and host sessions use `FicsitRemoteMonitoring` (E2, applying E2's own JSON Debug example to E3's key).
  - The value lives in `GameUserSettings.ini`, on a Windows dedicated server at `<Server Install Location>/FactoryGame/Saved/Config/WindowsServer/GameUserSettings.ini` (E2). The page says the system "allows for easier configuration in-game" and shows a "Dedicated Server Config Location" image (E1); the steps in game are not described in text.
  - FRM uses the game's `FGUserSettings` system since Satisfactory 1.2; the old `FactoryGame/Configs/FicsitRemoteMonitoring/WebServer.cfg` is no longer read (E1).
  - An invalid key is removed when the game saves the configuration (E2).
NOT FOUND (recorded, not guessed):
  - The ini section header and line syntax under which the key is written in `GameUserSettings.ini`: the page gives the key, not the file's text.
  - Whether a changed port takes effect without a restart.
---

### E1 — FGUserSettings since 1.2; the legacy config files are not read; in-game config (lines 5-28)

```asciidoc
Configuration for Ficsit Remote Monitoring

As of Satisfactory 1.2, Ficsit Remote Monitoring has been re-written to use the `FGUserSettings` system for configuration. This allows for easier configuration in-game. 

The legacy configuration files are still present for reference, but are not used by the mod anymore. The legacy configuration files are located in the `FactoryGame/Configs/FicsitRemoteMonitoring` folder, and are named `SerialDevices.cfg`, `DiscIT.cfg`, `MonitoringConfig.cfg`, and `WebServer.cfg`. 
```

```asciidoc
Single Player/Host Session Config Location
image:https://raw.githubusercontent.com/porisius/FicsitRemoteMonitoring/refs/heads/main/docs/modules/ROOT/pages/config/images/main_menu.png[Single Player/Host Session Config Location]

Dedicated Server Config Location
image:https://raw.githubusercontent.com/porisius/FicsitRemoteMonitoring/refs/heads/main/docs/modules/ROOT/pages/config/images/server_manager.png[Dedicated Server Location]
```

### E2 — Where the values are stored, and the Dedicated Server key prefix (lines 30-51)

```asciidoc
NOTE:

The configuration values are stored in the GameUserSettings.ini file, which can be found in the following locations: +
- Single Player/Host Session: +
`%localappdata%/FactoryGame/Saved/Config/Windows/GameUserSettings.ini` +
- Windows Dedicated Server: +
`<Server Install Location>/FactoryGame/Saved/Config/WindowsServer/GameUserSettings.ini` +
- Linux Dedicated Server: +
`<Server Install Location>/FactoryGame/Saved/Config/LinuxServer/GameUserSettings.ini`

The base configuration formats for Ficsit Remote Monitoring are the same for both Single Player/Host Session and Dedicated Server, but the configuration key prefixes are different. +
Single Player/Host Session configuration keys are prefixed with `FicsitRemoteMonitoring` while Dedicated Server configuration keys are prefixed with `FicsitRemoteMonitoring.Server`.

Example: JSON Debug Mode 

Single Player/Host Session: +
`FicsitRemoteMonitoring.Debug.JSONDebug`

Dedicated Server: +
`FicsitRemoteMonitoring.Server.Debug.JSONDebug`

The configurations listed below will display their unique configuration key. Ensure you use the correct configuration key prefix for both Single Player/Host Session and Dedicated Server to avoid confusion. If your configuration is not valid, when the game saves the configuration, it will remove them. Always double check your configuration keys and values to ensure they are correct.
```

### E3 — The web server's port key (lines 76-88)

```asciidoc
4+| === HTTP and Websocket Configurations: ===

|Key |Type |Configuration |Description 

|<prefix>.uWS.Autostart
|mIntValue
|Autostart Web Server
|True = Autostarts Web Server at Game Start/Load

|<prefix>.uWS.Port
|mStringValue
|Web Server Port
|TCP Port for Web Server, Default: 8080
```
