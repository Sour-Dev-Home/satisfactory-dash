Source: RFC 8628 (https://www.rfc-editor.org/rfc/rfc8628); host guides at https://xgamingserver.com/docs/satisfactory/mod-setup and https://hosthavoc.com/wiki/game-servers/satisfactory/automatic-restarts; search summaries of https://supercraft.host/wiki/satisfactory/update-mods and https://wiki.indifferentbroccoli.com/Satisfactory/UpdateMods
Captured: 2026-10-25
Method: plain HTTPS GET through a page-reading tool that returned the quoted passages (the quotes are the tool's, not re-checked against raw HTML). The supercraft and indifferentbroccoli pages could not be read (timeout / not fetched); their content is known only from a web-search summary and stays [NEEDS VERIFICATION].
Source kind: an IETF standard (quoted excerpts) and hosting companies' public guides (quoted excerpts only).
Why it is here: ADR-0057 (hosting coverage), amended: the zero-touch pairing flow and how mods and the agent are updated on a server that must stay on.
FINDINGS (as the sources state them):
  RFC 8628 (device authorization grant)
  - E1 (3.2): `device_code` is "The device verification code" the client polls with; `user_code` is "The end-user verification code" the user types; `expires_in` is "The lifetime in seconds of the "device_code" and "user_code"".
  - E2 (3.5): `slow_down` makes the client raise its polling interval "by 5 seconds for this and all subsequent requests"; `expired_token`: "The "device_code" has expired, and the device authorization session has concluded."; `access_denied`: "The authorization request was denied."
  - E3 (5.1): "recommended that the server rate-limit user code attempts" because short user codes carry less entropy.
  - E4 (5.2): users never see the device code, so "a very high entropy code SHOULD be used."
  - E5 (5.3): the requesting device is not the device from which the user grants access, so the approver's session says little about the device.
  - E6 (5.4): inform the user that they are authorizing a device and ask them to confirm they possess it; matters most with `verification_uri_complete`.
  - E7 (5.6): device clients "are generally incapable of maintaining the confidentiality of their credentials" and are treated as public clients.
  Mod install and update on hosts
  - E8 (xgamingserver mod setup): installation ends with the step "4. Restart the server". The page does not say whether to stop the server first or whether hot-swapping works.
  - E9 (search summary of host guides, not read in full): guides say to stop the server before installing or changing mods, that hot-swapping mods on a running server causes problems, and that the SMM "update" button is followed by a server restart. Client, server and mods need the same game, SML and mod versions.
  - E10 (search summary): SteamCMD updates the server binaries but does not restart the server.
  Host restart schedules
  - E11 (Host Havoc): "You can configure a schedule using the Scheduled Tasks feature in the game panel."; "choose Daily if you want the restart to occur at the same time each day"; the Advance Options include "waiting until the server is empty before restarting"; adjust the auto-save interval "so progress is preserved before each restart".
  - E12 (Supercraft, search summary only): the game has a built-in restart hour within a 24-hour cycle, in UTC, with a warning 5 minutes before: [NEEDS VERIFICATION].
NOT FOUND (recorded, not guessed):
  - Whether SML or any mod can be loaded, replaced or reloaded in a running dedicated server: no SML or ficsit.app page read says so, and the host guides imply it cannot. Treated as "a mod update needs a game-server restart", [NEEDS VERIFICATION] by a test on the rehearsal VM.
  - Which surfaces a panel host shows the player (console, log, file manager) differ by host and are not captured per host: see `game-hosts-panels-2026-10-25.md`. `FactoryGame.log` as a log file on a dedicated server is only said to "could" be under the install's `FactoryGame/Saved/Logs` (`sml-dedicated-servers-2026-09-27.adoc`).
  - Whether a server-only mod can send an in-game chat message to joined players, and whether a chat command can be registered on a dedicated server: [NEEDS VERIFICATION] (a spike).
