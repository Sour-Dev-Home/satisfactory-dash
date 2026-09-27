Source: local Steam install of Satisfactory, standard library location
(Steam/steamapps/common/Satisfactory/CommunityResources/DedicatedServerAPIDocs.md)
Captured: 2026-09-21 (GameVersion 1.2.4.0). Trimmed 2026-09-27 (#343).

This file holds only the verbatim excerpts this repo cites, numbered E1, E2, ... Cite them as
`dedicated-server-api.md` E<n>, never by line number. The full document ships with every
dedicated server install (path above); a full copy of the 2026-09-21 capture is kept outside the
repo, and the file's history in git has it too. Our own notes on how the live server differs from
these docs are in `docs-vault/wiki/vanilla-dedicated-server-api.md`.

Functions the document lists (names only): HealthCheck, VerifyAuthenticationToken,
PasswordlessLogin, PasswordLogin, QueryServerState, GetServerOptions, GetAdvancedGameSettings,
ApplyAdvancedGameSettings, ClaimServer, RenameServer, SetClientPassword, SetAdminPassword,
SetAutoLoadSessionName, RunCommand, Shutdown, ApplyServerOptions, CreateNewGame, SaveGame,
DeleteSaveFile, DeleteSaveSession, EnumerateSessions, LoadGame, UploadSaveGame, DownloadSaveGame.

---

### E1 — Lightweight Query API: what it is (UDP)

# Lightweight Query API

Lightweight Query API is a lightweight API designed to allow continuously pulling data from the server and track server state changes.

## Protocol

Lightweight Query is a simple request-response UDP protocol with a message-based approach.

### E2 — Lightweight Query API: availability while the HTTPS API is down

## API Availability

Lightweight Server Query API is available at all times when the server is running, except for when it is starting up. When the server is performing
a save game load or a map change, the lightweight query API will retain it's availability, but will report Loading as the server status.
In that state, HTTPS API becomes temporarily unavailable until the blocking work on the server is finished.

### E3 — HTTPS API, and certificate validation (self-signed by default)

# HTTPS API

Dedicated Server HTTPS API is designed for reliably retrieving data from the running dedicated server instance, and performing the server management.
It is available when the server has started up and not actively loading a save game or performing a map change. To check for the HTTPS API availability,
Lightweight Query API can be used.

## Certificate Validation and Encryption

HTTPS API is always wrapped into the TLS tunnel, even if the user did not provide the certificate for the Dedicated Server.

User Certificate will be looked up at the following path (where `$InstallRoot$` is the path where the Dedicated Server is installed):

| File Path                                                | File type               | Description                             |
|----------------------------------------------------------|-------------------------|-----------------------------------------|
| `$InstallRoot$/FactoryGame/Certificates/cert_chain.pem`  | Certificate Chain (PEM) | Certificate chain in PEM format         |
| `$InstallRoot$/FactoryGame/Certificates/private_key.pem` | Private Key (PEM)       | Certificate's private key in PEM format |

If no Certificate is provided by the user, Dedicated Server will generate it's own self-signed certificate and use it to encrypt
all traffic flowing through the HTTPS API. As such, the clients should be able to handle the HTTPS certificate being self-signed, recognize
that case, and handle it appropriately.

The game client, when presented with a self signed certificate from the Dedicated Server, will present it to the user and ask them to
manually confirm that the certificate in question is from a trusted authority. Once the user confirms it, the certificate is cached locally,
and is trusted for that specific server until the user revokes it or the server changes the certificate.

### E4 — Request and response schema, status codes, error and success shapes

## Schema

HTTPS API is based on a simple JSON schema used to pass data to the functions executing on the server, and pass the responses back to the caller.
All Server API functions are always executed as POST requests, although certain query requests support being executed through the GET
requests, provided that they do not require any data to be provided to them.

### Request Schema

Content Type for requests should be set to application/json. Encoding should preferably be set to utf-8, but Dedicated Servers
support all encoding supported by the ICU localization library.

Request Object has the following properties:

| Property Name | Property Type | Description                                                                                           |
| ------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| function      | string        | Name of the API function to execute. Names of the API functions and their behavior is described below |
| data          | object        | Data to pass to the function to execute. Format of the object depends on the function being executed  |

Dedicated Server HTTPS API supports the following standard headers:

| Header Name      | Notes                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Content-Encoding | Optional. Only gzip and deflate are supported                                                                        |
| Authorization    | Required for most non-Authorization API functions. Only Bearer tokens are supported. See Authorization for more info |

The following Satisfactory-specific headers can be also be used in the request:

| Header Name            | Data Type     | Description                                                                                 |
| X-FactoryGame-PlayerId | Hex String    | Hex-encoded byte array encoding the ID of the player on behalf of which the request is made | 

X-FactoryGame-PlayerId header is only needed to obtain the server join/encryption tickets used for joining the server,
and it's format is highly specific to the Satisfactory version running, Unreal Engine version, and the Online Backend used by the player.

Generally, first byte of the ID will be type of the Online Backend used (1 for Epic Games Store, 6 for Steam, see values in UE's EOnlineServices type),
and the following bytes are specific to the Online Backend, but will generally represent the player account ID.
For Steam for example, it would be a big-endian uint64 representing the player's SteamID64, and for Epic, it would be HEX-encoded EOS ProductUserId string.

### Response Schema

Dedicated Server can return a variety of different HTTP status codes, most prominent ones are described here:

| Status Code | Status Code Name  | Description                                                                                                                                                      |
| ----------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200         | Ok                | The function has been executed successfully. The response body will either be a Error Response or a Success Response                                             |
| 201         | Created           | The function has been executed and returned no error. Returned by some functions to indicate that a new file has been created, such as UploadSaveGame            |
| 202         | Accepted          | The function has been executed, but is still being processed. This is returned by some functions with side deffects, such as LoadGame                            |
| 204         | No Content        | The function has been executed successfully, but returned no data (and no error)                                                                                 |
| 400         | Bad Request       | Only returned when the request body was failed to be parsed as valid JSON or multipart request. In other cases, error response bad_request is used               |
| 401         | Denied            | Authentication token is missing, cannot be parsed, or has expired                                                                                                |
| 403         | Forbidden         | Provided authentication does not allow executing the provided function, or when function requiring authentication is called without one                          |
| 404         | Not Found         | The specified function cannot be found, or when the function cannot find the specified resource in some cases (for example, for DownloadSaveGame)                |
| 415         | Unsupported Media | Specified charset or content encoding is not supported, or multipart data is malformed                                                                           |
| 500         | Server Error      | An internal server error has occurred when executing the function                                                                                                |

Content Type of the server response will be set to application/json and utf-8 encoding.
Depending on the outcome of the operation, it might return either an error response or a data response.

Error Response has the following structure:

| Property Name | Property Type | Description                                                                                           |
| ------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| errorCode     | string        | Machine-friendly code indicating the type of the error that the executed function returned            |
| errorMessage  | string?       | Optional. Human-friendly error message explaining the error                                           |
| errorData     | object?       | Optional. Additional information about the error, for example, list of parameters that are missing    |

Success Response has the following structure:

| Property Name | Property Type | Description                                                                                           |
| ------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| data          | object?       | Data returned by the function executed. Type depends on the function the request performed            |


### E5 — Authentication: token format, privilege levels, application tokens, insecure local access

## Authentication

Dedicated Server API requires authentication for most of it's functions. Authentication format used are Bearer tokens, which are issued
by the Dedicated Server when using certain API functions that require no Authentication (such as PasswordlessLogin), or functions that require
additional security verification (such as PasswordLogin). Tokens generated by these functions are short-lived and are bound to the specific player account.

Authentication Tokens internally consist of two parts separated by the dot character ('.'):
- Base64-encoded JSON token payload
- HEX-encoded Fingerprint

JSON token payload can be retrieved to determine the privilege level granted by the token, while fingerprint part is used by the server
to check the validity of the token and whenever it can be used currently.

Internal Authentication Token Payload:
| Property Name | Property Type | Description                                                                                           |
| ------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| pl            | string        | Privilege Level granted by this token. See possible values below                                      |

Possible Privilege Level values:

| Privilege Level  | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| NotAuthenticated | The client is not Authenticated                                              |
| Client           | Client is Authenticated with Client privileges                               |
| Administrator    | Client is Authenticated with Admin privileges                                |
| InitialAdmin     | Client is Authenticated as Initial Admin with privileges to Claim the server |
| APIToken         | Client is Authenticated as Third Party Application                           |

The following functions are used by the game client to perform player authentication:

| Function Name             | Description                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| PasswordlessLogin         | Attempts logging in as a player without a password.                                 |
| PasswordLogin             | Attempts logging in as a player with a password.                                    |
| VerifyAuthenticationToken | Checks if the provided Authentication token is valid. Returns Ok if valid           |

Third Party Applications should NOT use PasswordLogin or PasswordlessLogin, and should instead rely on the Application Tokens.

Application tokens do not expire, and are granted by issuing the command `server.GenerateAPIToken` in the Dedicated Server console.
The generated token can then be passed to the Authentication header with Bearer type to perform any Server API requests on the behalf of the server.

Application tokens generated previously can still be pruned using `server.InvalidateAPITokens` console command.

Authentication requirement can be lifted for locally running Dedicated Server instances serving on the loopback network adapter.
To allow unrestricted Dedicated Server API access on the localhost, set `FG.DedicatedServer.AllowInsecureLocalAccess` console variable to `1`.
It can be performed automatically using the following command line argument:
`-ini:Engine:[SystemSettings]:FG.DedicatedServer.AllowInsecureLocalAccess=1`

### E6 — HealthCheck ("healthy" above ten ticks per second)

## API Functions

The following functions are currently available in the vanilla Dedicated Server

### HealthCheck

Performs a health check on the Dedicated Server API. Allows passing additional data between Modded Dedicated Server and Modded Game Client.
This function requires no Authentication.

Function Request Data:

| Property Name        | Property Type       | Description                                                                                           |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| ClientCustomData     | string              | Custom Data passed from the Game Client or Third Party service. Not used by vanilla Dedicated Servers |

Function Response Data:

| Property Name        | Property Type       | Description                                                                                                                           |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Health               | string              | "healthy" if tick rate is above ten ticks per second, "slow" otherwise                                                                |
| ServerCustomData     | string              | Custom Data passed from the Dedicated Server to the Game Client or Third Party service. Vanilla Dedicated Server returns empty string |

### E7 — VerifyAuthenticationToken (documented: no parameters, No Content)

### VerifyAuthenticationToken

Verifies the Authentication token provided to the Dedicated Server API. Returns No Content if the provided token is valid.
This function does not require input parameters and does not return any data.

### E8 — QueryServerState and ServerGameState fields

### QueryServerState

Retrieves the current state of the Dedicated Server. Does not require any input parameters.

Function Response Data:

| Property Name   | Property Type | Description                                                                                           |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| ServerGameState | string        | Current game state of the server                                                                      |

ServerGameState:

| Property Name       | Property Type | Description                                                                                           |
| ------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| ActiveSessionName   | string        | Name of the currently loaded game session                                                             |
| NumConnectedPlayers | integer       | Number of the players currently connected to the Dedicated Server                                     |
| PlayerLimit         | integer       | Maximum number of the players that can be connected to the Dedicated Server                           |
| TechTier            | integer       | Maximum Tech Tier of all Schematics currently unlocked                                                |
| ActiveSchematic     | string        | Schematic currently set as Active Milestone                                                           |
| GamePhase           | string        | Current game phase. None if no game is running                                                        |
| IsGameRunning       | boolean       | True if the save is currently loaded, false if the server is waiting for the session to be created    |
| TotalGameDuration   | integer       | Total time the current save has been loaded, in seconds                                               |
| IsGamePaused        | boolean       | True if the game is paused. If the game is paused, total game duration does not increase              |
| AverageTickRate     | float         | Average tick rate of the server, in ticks per second                                                  |
| AutoLoadSessionName | string        | Name of the session that will be loaded when the server starts automatically                          |

### E9 — GetServerOptions

### GetServerOptions

Retrieves currently applied server options and server options that are still pending application (because of needing session or server restart)
Does not require input parameters.

Function Response Data:

| Property Name        | Property Type       | Description                                                                                           |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| ServerOptions        | map<string, string> | All current server option values. Key is the name of the option, and value is it's stringified value  |
| PendingServerOptions | map<string, string> | Server option values that will be applied when the session or server restarts                         |

### E10 — ApplyServerOptions (Admin; UpdatedServerOptions)

### ApplyServerOptions

Applies new Server Options to the Dedicated Server. Requires Admin privileges.
Function does not return any data on success.

Function Request Data:

| Property Name                | Property Type       | Description                                                                                   |
| ---------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| UpdatedServerOptions         | map<string, string> | Key is the name of the Server Option, and the Value is the new value as string                |

### E11 — CreateNewGame and ServerNewGameData

### CreateNewGame

Creates a new session on the Dedicated Server, and immediately loads it. HTTPS API becomes temporarily unavailable when map loading is in progress   |
Function does not return any data on success.

| Property Name        | Property Type       | Description                                                                                           |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| NewGameData          | ServerNewGameData   | Parameters needed to create new game session                                                          |

ServerNewGameData:

| Property Name               | Property Type       | Description                                                                                                |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| SessionName                 | string              | Name of the session to create                                                                              |
| MapName                     | string              | Path Name to the Map Package to use as a map. If not specified, default level                              |
| StartingLocation            | string              | Name of the starting location to use. Leaving it empty will use random starting location                   |
| SkipOnboarding              | boolean             | Whenever the Onboarding should be skipped. Currently Onboarding is always skipped on the Dedicated Servers |
| AdvancedGameSettings        | map<string, string> | Advanced Game Settings to apply to the newly created session                                               |
| CustomOptionsOnlyForModding | map<string, string> | Custom Options to pass to the newly created session URL. Not used by vanilla Dedicated Servers             |
