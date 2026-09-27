Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/authentication.html
Captured: 2026-09-21. Trimmed 2026-09-27 (#343).

FicsitRemoteMonitoring's docs carry no licence (all rights reserved), so this file keeps only the
excerpts this repo cites, verbatim, numbered E1, E2, ... Cite them as `frm-authentication.md` E<n>, never by line
number. The full page is at the source URL; a full copy of the 2026-09-21 capture is kept outside
the repo, and this file's git history has it too.

---

### E1 — Where the token lives, and the X-FRM-Authorization header

## Authentication

An authentication token is automatically generated when the mod is loaded.

The token can be found in the `Configs/FicsitRemoteMonitoring/WebServer.cfg` file under the `Authentication_Token` key. You can also set your own token in the file.  
If left empty, a new token will be generated.

## Passing the token to the API

Use it to set an API request’s Authorization header. `X-FRM-Authorization: <token goes here>`

## Our note (2026-09-21)

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
