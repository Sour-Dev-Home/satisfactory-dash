Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/dedicatedserver.html
Captured: 2026-09-21. Trimmed 2026-09-27 (#343).

FicsitRemoteMonitoring's docs carry no licence (all rights reserved), so this file keeps only the
excerpts this repo cites, verbatim, numbered E1, E2, ... Cite them as `frm-dedicated-server.md` E<n>, never by line
number. The full page is at the source URL; a full copy of the 2026-09-21 capture is kept outside
the repo, and this file's git history has it too.

---

### E1 — FRM through the game's API port (https://<ServerIP>:7777/api/v1/)

## Dedicated Server API

FRM can, now as of 1.1, interface with Satisfactory's Dedicated Server API Port that can be
accessed, by default, at `https://<ServerIP>:7777/api/v1/` (Ex. `https://localhost:7777/api/v1/`).
The Network Port will depend on the port you set for your Dedicated Server.

### E2 — A fallback when the FRM Web Server can't be reached

Please note that this is not the same as the FRM Web Server, and is not intended to be used
in the same way. This is due to how Coffee Stain Studios designed the Satisfactory Dedicated
Server API. However, if you cannot access the FRM Web Server, you can use the Game Port API
as a fallback as the TCP Port is required to be accessible for normal gameplay.

### E3 — Every request through the game port runs in the game thread; big requests can cause hiccups

There are some differences between the FRM Web Server and the Game Port API, which are
listed below:

- Please note that **ALL OF FRM'S ENDPOINTS** will use the game's `GameThread` to execute
  the request.
  - All endpoints are accessible via this API as `NotAuthenticated`, however any FRM
    Endpoints that require authentication will rely on FRM's Authentication Token to be
    passed in the request header. Please refer to the respective endpoint documentation for
    more information. This is a design choice by the FRM Development Team to establish a
    standard for all endpoints.
  - This is not the case with the FRM Web Server, which uses a separate thread to execute
    most requests. Please note that some requests may still use the `GameThread` to execute,
    such as the `getPlayer` endpoint to obtain some, if not all, of the data for the
    respective endpoint.
  - We cannot change this behavior, as it is how the game is designed. The FRM Development
    Team has tried to make all of FRM's Endpoints as efficient as possible. However, larger
    requests, such as `getFactory`, may still cause minor hiccups in the Dedicated Server's
    performance.
  - Smaller saves/worlds will not experience this issue as much as larger saves/worlds. This
    mod is routinely tested on saves with 1000+ hours of playtime and 10000+ items in the
    factory. However, please note that this is not a guarantee that you will not experience
    any issues.

### E4 — POST only, and the example request

- The Game Port API does not support simple GET requests for API data. You must use a POST
  request in the following format to get data returned. Please refer to each endpoint's
  documentation for the specific request body.
  - Example request using PowerShell 7's `Invoke-WebRequest` (a similar request can also be
    made with `curl`):

    ```
    Invoke-WebRequest -Uri https://localhost:7777/api/v1 -Method POST -ContentType application/json -Body '{"function": "frm", "endpoint": "getPlayer"}' -SkipCertificateCheck
    ```

## Our notes (2026-09-21, updated 2026-09-27)

- This page describes FRM's endpoints reachable *through* the vanilla Dedicated Server API port (7777) as
  an alternative transport, not the vanilla API's own functions (those are in `dedicated-server-api.md`).
  Tried live in the Phase 2 spike: it answered 404 (`captured-responses/frm-tunneled-transport-404.md`).
- The page links to https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API as another reference for
  the official API; that page has not been captured here and should be treated as [NEEDS VERIFICATION].
