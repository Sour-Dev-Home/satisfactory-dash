Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/dedicatedserver.html
Captured: 2026-09-21

---

## Dedicated Server API

FRM can, now as of 1.1, interface with Satisfactory's Dedicated Server API Port that can be
accessed, by default, at `https://<ServerIP>:7777/api/v1/` (Ex. `https://localhost:7777/api/v1/`).
The Network Port will depend on the port you set for your Dedicated Server.

This feature is not available for the base game, and is only available for the Dedicated
Server. This is Coffee Stain Studios' design for the game, and we cannot enable this feature
for the base game.

For setting up your Dedicated Server, please refer to the official documentation at
https://satisfactory.wiki.gg/wiki/Dedicated_servers. Also for documentation on the
**Official** API, please refer to https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API.

Please note that this is not the same as the FRM Web Server, and is not intended to be used
in the same way. This is due to how Coffee Stain Studios designed the Satisfactory Dedicated
Server API. However, if you cannot access the FRM Web Server, you can use the Game Port API
as a fallback as the TCP Port is required to be accessible for normal gameplay.

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
- The Game Port API does not support simple GET requests for API data. You must use a POST
  request in the following format to get data returned. Please refer to each endpoint's
  documentation for the specific request body.
  - Example request using PowerShell 7's `Invoke-WebRequest` (a similar request can also be
    made with `curl`):

    ```
    Invoke-WebRequest -Uri https://localhost:7777/api/v1 -Method POST -ContentType application/json -Body '{"function": "frm", "endpoint": "getPlayer"}' -SkipCertificateCheck
    ```

    Example response:

    ```
    StatusCode        : 200
    StatusDescription : OK
    Content           : [{"ID":"Char_Player_C_2146409224","Name":"","ClassName":"Char_Player_C","location":{"x":-258596.109
                        375,"y":-48086.0078125,"z":439.743896484375,"rotation":353.14453212390106},"Online":false,"PlayerHP
                        ":...
    RawContent        : HTTP/1.1 200 OK
                        Server: FactoryGame/++FactoryGame+rel-main-1.1.0-CL-415558
                        Server: (Windows)
                        Keep-Alive: timeout=15.000000
                        Content-Type: application/json; charset=utf-8
                        Content-Disposition: inlin...
    Headers           : {[Server, System.String[]], [Keep-Alive, System.String[]], [Content-Type, System.String[]],
                        [Content-Disposition, System.String[]]...}
    Images            : {}
    InputFields       : {}
    Links             : {}
    RawContentLength  : 1522
    RelationLink      : {}
    ```

  - Example request body for getting the list of players on the server (see each endpoint's
    own documentation page for its JSON response shape):

    ```json
    {
        "function": "frm",
        "endpoint": "getPlayer"
    }
    ```

  - Example using the `sendChatMessage` endpoint to send a message to the server, with
    request and response:

    Request:
    ```json
    {
        "function": "frm",
        "endpoint": "sendChatMessage",
        "data":
        {
            "message": "Hello World :)"
        }
    }
    ```

    Response:
    ```json
    {
        "IsSent": true,
        "Message": "Hello World :)"
    }
    ```

More optimizations and endpoints are planned for the future. Please refer to the official
and mod documentations for more information.

## Notes

- This describes FRM's endpoints being reachable *through* the vanilla Dedicated Server API
  port (7777) as an alternative transport, not the vanilla API's own native function set.
  The vanilla API's own functions (`QueryServerState`, `GetServerOptions`, etc.) are
  documented separately in `CommunityResources/DedicatedServerAPIDocs.md` from the dedicated
  server install — see `dedicated-server-api.md` in this folder [NOT YET CAPTURED — no local
  dedicated server install found on this machine as of 2026-09-21, see docs-vault/wiki/log.md].
- The page links out to https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API as an
  alternate reference for the official API; that page has not been captured here and should
  be treated as [NEEDS VERIFICATION] until it is.
