Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/config/current/config.html
Captured: 2026-09-21. Trimmed 2026-09-27 (#343).

FicsitRemoteMonitoring's docs carry no licence (all rights reserved), so this file keeps only the
excerpts this repo cites, verbatim, numbered E1, E2, ... Cite them as `frm-config.md` E<n>, never by line
number. The full page is at the source URL; a full copy of the 2026-09-21 capture is kept outside
the repo, and this file's git history has it too.
The page's settings table is HTML; its rows are quoted below as Markdown tables with the text unchanged.

---

### E1 — Where the settings live (GameUserSettings.ini) and the Dedicated Server key prefix

NOTE:

The configuration values are stored in the GameUserSettings.ini file, which can be found in the following locations:  
\- Single Player/Host Session:  
`%localappdata%/FactoryGame/Saved/Config/Windows/GameUserSettings.ini`  
\- Windows Dedicated Server:  
`<Server Install Location>/FactoryGame/Saved/Config/WindowsServer/GameUserSettings.ini`  
\- Linux Dedicated Server:  
`<Server Install Location>/FactoryGame/Saved/Config/LinuxServer/GameUserSettings.ini`

The base configuration formats for Ficsit Remote Monitoring are the same for both Single Player/Host Session and Dedicated Server, but the configuration key prefixes are different.  
Single Player/Host Session configuration keys are prefixed with `FicsitRemoteMonitoring` while Dedicated Server configuration keys are prefixed with `FicsitRemoteMonitoring.Server`.

### E2 — HTTP and Websocket settings: the whole section (Autostart, Port 8080, token; no TLS setting)

| Key | Type | Configuration | Description |
| --- | --- | --- | --- |
| .uWS.Autostart | mIntValue | Autostart Web Server | True = Autostarts Web Server at Game Start/Load |
| .uWS.Port | mStringValue | Web Server Port | TCP Port for Web Server, Default: 8080 |
| .uWS.Root | mStringValue | File Root Location | File location of web root, Default:  Leave blank or "" for default location. |
| .uWS.AuthenticationToken | mStringValue | API Authentication Token | Auto-generated token that can also be found in the logs at startup. This is used to authenticate certain API requests to prevent unauthorized access. If left blank, it will auto-generate a token at startup. |
| .uWS.PushCycle | mStringValue | Websocket Push Cycle | Push cycle for WebSocket updates, Default: 5.0 |

### E3 — Webhook settings for power: outage and battery levels

| Key | Type | Configuration | Description |
| --- | --- | --- | --- |
| .DiscIT.OutageJSON | mStringValue | Power Outage JSON File | Absolute path of Webhook JSON File. If Blank/"", then uses the default. |
| .DiscIT.PwrUPSJSON | mStringValue | Battery Notification JSON File | Absolute path of Webhook JSON File. If Blank/"", then uses the default. |
| .DiscIT.Battery | mStringValue | Battery Notification Levels | Array of float values to trigger Battery Notification webhook at certain Battery Levels (in %), expects comma separated values, i.e. "20,40,60,80" |
