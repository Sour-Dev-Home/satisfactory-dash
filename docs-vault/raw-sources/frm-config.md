Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/config/current/config.html
Captured: 2026-09-21

---

## Configurations

Configuration for Ficsit Remote Monitoring

As of Satisfactory 1.2, Ficsit Remote Monitoring has been re-written to use the `FGUserSettings` system for configuration. This allows for easier configuration in-game.

The legacy configuration files are still present for reference, but are not used by the mod anymore. The legacy configuration files are located in the `FactoryGame/Configs/FicsitRemoteMonitoring` folder, and are named `SerialDevices.cfg`, `DiscIT.cfg`, `MonitoringConfig.cfg`, and `WebServer.cfg`.

These files are not used by the mod anymore, but are left for reference for anyone who wants to see how the mod was configured in the past or wants to use them to migrate to the new system. A migration process was not added due to concerns about potential issues with parsing old config files and the fact that the new system is more user-friendly and easier to configure in-game.

If you are having issues connecting to the Web Server or Serial Device, please update your configuration to the new system. Refer to the old/legacy configuration files located in the `FactoryGame/Configs/FicsitRemoteMonitoring` folder for Ficsit Remote Monitoring.

|  | Please note that there is a difference between the Single Player/Host Session configuration and the Dedicated Server configuration. The Single Player/Host Session configuration is used for single player games and when hosting a multiplayer session, while the Dedicated Server configuration is used for dedicated servers.  Make sure to update the correct configuration based on your use case as using the Single Player/Host Session configuration for a dedicated server or vice versa may lead to unexpected behavior or issues with the mod.  A fix is in the works to resolve the confusion between the two configurations, but in the meantime, please make sure to update the correct configuration based on your use case. |
| --- | --- |

Single Player/Host Session Config Location

![Single Player/Host Session Config Location](https://raw.githubusercontent.com/porisius/FicsitRemoteMonitoring/refs/heads/main/docs/modules/ROOT/pages/config/images/main_menu.png)

Single Player/Host Session Config Location

Dedicated Server Config Location

![Dedicated Server Location](https://raw.githubusercontent.com/porisius/FicsitRemoteMonitoring/refs/heads/main/docs/modules/ROOT/pages/config/images/server_manager.png)

Dedicated Server Location

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

Example: JSON Debug Mode

Single Player/Host Session:  
`FicsitRemoteMonitoring.Debug.JSONDebug`

Dedicated Server:  
`FicsitRemoteMonitoring.Server.Debug.JSONDebug`

The configurations listed below will display their unique configuration key. Ensure you use the correct configuration key prefix for both Single Player/Host Session and Dedicated Server to avoid confusion. If your configuration is not valid, when the game saves the configuration, it will remove them. Always double check your configuration keys and values to ensure they are correct.

<table><colgroup><col> <col> <col> <col></colgroup><tbody><tr><td colspan="4"><p>=== General Configurations: ===</p></td></tr><tr><td><p>Key</p></td><td><p>Type</p></td><td><p>Configuration</p></td><td><p>Description</p></td></tr><tr><td><p><prefix>.General.SplineSampleDistance</p></td><td><p>mFloatValue</p></td><td><p>Spline Sample Distance</p></td><td><p>Distance along spline to measure for each spline point for getTrainRails, getBelts, getPipes, etc Lower numbers will create more data points for Spline JSON Objects, but potentially hurts performance. Recommendations are about 50-100 for Game-world accuracy or fine minimap, and 200-1000 for Low-res preview or performance focused use cases.</p></td></tr><tr><td colspan="4"></td></tr><tr><td colspan="4"><p>=== Debug Configurations: ===</p></td></tr><tr><td><p>Key</p></td><td><p>Type</p></td><td><p>Configuration</p></td><td><p>Description</p></td></tr><tr><td><p><prefix>.Debug.JSONDebug</p></td><td><p>mIntValue</p></td><td><p>JSON Debug Mode</p></td><td><p>If False, removes the unnecessary white spaces and line breaks, shortens and reduces amount needed to transmit. If True, JSON becomes more human readable.</p></td></tr><tr><td colspan="4"></td></tr><tr><td colspan="4"><p>=== HTTP and Websocket Configurations: ===</p></td></tr><tr><td><p>Key</p></td><td><p>Type</p></td><td><p>Configuration</p></td><td><p>Description</p></td></tr><tr><td><p><prefix>.uWS.Autostart</p></td><td><p>mIntValue</p></td><td><p>Autostart Web Server</p></td><td><p>True = Autostarts Web Server at Game Start/Load</p></td></tr><tr><td><p><prefix>.uWS.Port</p></td><td><p>mStringValue</p></td><td><p>Web Server Port</p></td><td><p>TCP Port for Web Server, Default: 8080</p></td></tr><tr><td><p><prefix>.uWS.Root</p></td><td><p>mStringValue</p></td><td><p>File Root Location</p></td><td><p>File location of web root, Default: <empty> Leave blank or "" for default location.</p></td></tr><tr><td><p><prefix>.uWS.AuthenticationToken</p></td><td><p>mStringValue</p></td><td><p>API Authentication Token</p></td><td><p>Auto-generated token that can also be found in the logs at startup. This is used to authenticate certain API requests to prevent unauthorized access. If left blank, it will auto-generate a token at startup.</p></td></tr><tr><td><p><prefix>.uWS.PushCycle</p></td><td><p>mStringValue</p></td><td><p>Websocket Push Cycle</p></td><td><p>Push cycle for WebSocket updates, Default: 5.0</p></td></tr><tr><td colspan="4"></td></tr><tr><td colspan="4"><p>=== Serial/RS232 Configurations: ===</p></td></tr><tr><td><p>Key</p></td><td><p>Type</p></td><td><p>Configuration</p></td><td><p>Description</p></td></tr><tr><td><p><prefix>.Serial.Port</p></td><td><p>mStringValue</p></td><td><p>Serial Port</p></td><td><p>Serial/RS232 Port (Requires ArduinoKit). Changes from UE4Duino, you must specify the device name (i.e. COM3) Linux/Mac operations have not been explored at this time to document, but are supported.</p></td></tr><tr><td><p><prefix>.Serial.BaudRate</p></td><td><p>mStringValue</p></td><td><p>Baud Rate</p></td><td><p>Serial/RS232 Baud Rate (Requires ArduinoKit)</p></td></tr><tr><td><p>Serial.Autostart</p></td><td><p>mIntValue</p></td><td><p>Autostart Serial Device</p></td><td><p>True = Starts serial communication at startup (Requires ArduinoKit)</p></td></tr><tr><td><p><prefix>.Serial.TickDelay</p></td><td><p>mStringValue</p></td><td><p>Serial Tick Delay</p></td><td><p>Delay between updates (in seconds) to serial device. This is only used for cases with Auto_Serial. (Requires ArduinoKit)</p></td></tr><tr><td><p><prefix>.Serial.StackSize</p></td><td><p>mStringValue</p></td><td><p>Serial Stack Size</p></td><td><p>Maximum buffer size (Requires ArduinoKit)</p></td></tr><tr><td colspan="4"></td></tr><tr><td colspan="4"><p>=== Webhook Notifications: ===</p></td></tr><tr><td><p>Key</p></td><td><p>Type</p></td><td><p>Configuration</p></td><td><p>Description</p></td></tr><tr><td><p><prefix>.DiscIT.URL</p></td><td><p>mStringValue</p></td><td><p>Webhook URL Path</p></td><td><p>URL Path to send Webhook Notifications</p></td></tr><tr><td><p><prefix>.DiscIT.DerailJSON</p></td><td><p>mStringValue</p></td><td><p>Train Derailment JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.OutageJSON</p></td><td><p>mStringValue</p></td><td><p>Power Outage JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.PwrUPSJSON</p></td><td><p>mStringValue</p></td><td><p>Battery Notification JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.Battery</p></td><td><p>mStringValue</p></td><td><p>Battery Notification Levels</p></td><td><p>Array of float values to trigger Battery Notification webhook at certain Battery Levels (in %), expects comma separated values, i.e. "20,40,60,80"</p></td></tr><tr><td><p><prefix>.DiscIT.PlayerOnline</p></td><td><p>mStringValue</p></td><td><p>Player Online JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.PlayerOffline</p></td><td><p>mStringValue</p></td><td><p>Player Offline JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.ResearchJSON</p></td><td><p>mStringValue</p></td><td><p>MileStone/MAM JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.HardDriveJSON</p></td><td><p>mStringValue</p></td><td><p>Hard Drive JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.FlavorTextJSON</p></td><td><p>mStringValue</p></td><td><p>Flavor Text JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.Doggo</p></td><td><p>mStringValue</p></td><td><p>Doggo JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr><tr><td><p><prefix>.DiscIT.TrainErrorJSON</p></td><td><p>mStringValue</p></td><td><p>Train Error JSON File</p></td><td><p>Absolute path of Webhook JSON File. If Blank/"", then uses the default.</p></td></tr></tbody></table>