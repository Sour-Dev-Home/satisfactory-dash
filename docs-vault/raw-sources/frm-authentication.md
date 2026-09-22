Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/authentication.html
Captured: 2026-09-21

---

## Authentication

An authentication token is automatically generated when the mod is loaded.

The token can be found in the `Configs/FicsitRemoteMonitoring/WebServer.cfg` file under the `Authentication_Token` key. You can also set your own token in the file.  
If left empty, a new token will be generated.

## Passing the token to the API

Use it to set an API request’s Authorization header. `X-FRM-Authorization: <token goes here>`
Note: this page describes the token file location using the legacy config path
(Configs/FicsitRemoteMonitoring/WebServer.cfg). As of Satisfactory 1.2+, per
frm-config.md, the actual config system is FGUserSettings; the same token is
found in FactoryGame/Saved/Config/WindowsServer/GameUserSettings.ini under the
key FicsitRemoteMonitoring.Server.uWS.AuthenticationToken (confirmed directly
during the Phase 2 spike -- see docs-vault/wiki/log.md). The header name for
passing the token (X-FRM-Authorization) is presumed still current since it's
not part of the config-system rewrite, but has not been live-verified -- our
spike's server had no token enforcement to test against (AllowInsecureLocalAccess
may have also disabled FRM's own auth check, or FRM simply doesn't enforce its
token for loopback requests). [NEEDS VERIFICATION] against a token-enforcing
instance before relying on this header name in the adapter.
