Source: local Steam install of Satisfactory, standard library location, `CommunityResources/DedicatedServerAPIDocs.md` (Steam app 526870, build ID 25782416; `FactoryGameSteam-Win64-Shipping.version`: GameVersion 1.2.4.1, Changelist 513885, the same CL as the test install in `mod-claims.md`). The file has no public URL; this pins it by build and by content: SHA-256 `a1fd943f0c799d93971a887292246dc0a01bc995c0ccbb38702fa9ef8a4dc957`, 724 lines.
Captured: 2026-10-20, about 00:20Z (read just before the wiki capture at 00:23:38Z in `dedicated-server-save-files-2026-10-20.md`; the exact second was not recorded)
Method: read the file from the install and copied the sections below unedited (the Markdown tables keep the source's spacing). This is the game client install's copy; the document says it ships with dedicated server installs too (`dedicated-server-api.md`), and a dedicated server install's own copy was not compared.
Source kind: **official** (Coffee Stain's API document shipped with the game).
Excerpts only: the document carries no licence statement, so only quoted excerpts are kept, as in `dedicated-server-api.md`.
Item: ADR-0039 G0 addendum 2 (#462): how to make a dedicated server load one particular save (spikes S3 and S5).
FINDINGS (as the document states them):
  - `SetAutoLoadSessionName` sets the session the server loads automatically on startup; it does not change the loaded session (E1).
  - `EnumerateSessions` lists the saves the server has, grouped by session, each with its `SaveName` ("Name of the save game file in the filesystem") (E2).
  - `LoadGame` loads a save by `SaveName`; it fails with `save_game_load_failed` when the server cannot find that file (E3).
  - `UploadSaveGame` uploads a save file (multipart) under a given name and can load it at once (`LoadSaveGame`) (E4).
  - All four require Admin privileges (E1-E4).
NOT FOUND (recorded, not guessed):
  - Where the server keeps its save files or its settings on disk: the document names no path (searched for "SaveGames", "LocalAppData" and "path"). See `dedicated-server-save-files-2026-10-20.md` (a community source).
  - A launch argument or ini setting that loads a given save.
---

### E1 — SetAutoLoadSessionName

```markdown
### SetAutoLoadSessionName

Updates the name of the session that the Dedicated Server will automatically load on startup. Does not change currently loaded session.
Requires Admin privileges. Function does not return any data on success.

Function Request Data:

| Property Name        | Property Type       | Description                                                                                           |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| SessionName          | string              | Name of the session to automatically load on Dedicated Server startup                                 |
```

### E2 — EnumerateSessions, SessionSaveStruct and SaveHeader

```markdown
### EnumerateSessions

Enumerates all save game files available on the Dedicated Server. Requires Admin privileges. Function does not require any additional parameters.

Function Response Data:

| Property Name        | Property Type            | Description                                                         |
| -------------------- | ------------------------ | ------------------------------------------------------------------- |
| Sessions             | array<SessionSaveStruct> | List of sessions available on the Dedicated Server                  |
| CurrentSessionIndex  | integer                  | Index of the currently selected session in the list                 |

Possible errors:

| Error Code                 | Description                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| enumerate_sessions_failed  | Failed to enumerate save sessions. Additional information might be available in errorMessage property   |

SessionSaveStruct:

| Property Name               | Property Type       | Description                                                                                                |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| SessionName                 | string              | Name of the save session                                                                                   |
| SaveHeaders                 | array<SaveHeader>   | All save game files belonging to this session                                                              |

SaveHeader:

| Property Name               | Property Type       | Description                                                                                                |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| SaveVersion                 | integer             | Version of the Save Game format this file was saved with                                                   |
| BuildVersion                | integer             | Changelist of the game or dedicated server this file was saved by                                          |
| SaveName                    | string              | Name of the save game file in the filesystem                                                               |
| MapName                     | string              | Path to the map package this save game file is based on                                                    |
| MapOptions                  | string              | Additional Map URL options this save game was saved with                                                   |
| SessionName                 | string              | Custom Options to pass to the newly created session URL. Not used by vanilla Dedicated Servers             |
| PlayDurationSeconds         | integer             | Amount of seconds the game has been running for in total since the session was created                     |
| SaveDateTime                | string              | Date and time on which the save game file was saved                                                        |
| IsModdedSave                | boolean             | True if this save game file was saved with mods                                                            |
| IsEditedSave                | boolean             | True if this save game file has been edited by third party tools                                           |
| IsCreativeModeEnabled       | boolean             | True if Advanced Game Settings are enabled for this save game                                              |
```

(The `SessionName` row's description is the source's, as written.)

### E3 — LoadGame

```markdown
### LoadGame

Loads the save game file by name, optionally with Advanced Game Settings enabled. Requires Admin privileges.
Dedicated Server HTTPS API will become temporarily unavailable when save game is being loaded.
Function does not return any data on succcess.

Function Request Data:

| Property Name               | Property Type            | Description                                                                 |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| SaveName                    | string                   | Name of the save game file to load                                          |
| EnableAdvancedGameSettings  | boolean                  | True if save game file should be loaded with Advanced Game Settings enabled |

Possible errors:

| Error Code                 | Description                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| save_game_load_failed      | Failed to find the save game file with the given name on the Dedicated Server                           |
```

### E4 — UploadSaveGame

```markdown
### UploadSaveGame

Uploads save game file to the Dedicated Server with the given name, and optionally immediately loads it.
Requires Admin privileges. If save file is immediately loaded, Dedicated Server HTTPS API will become temporarily unavailable until save game is loaded.
This function does not return any data on success.

This function requires multipart-encoded form data as it's body. The following multipart part names are allowed:

| Multipart Field            | Description                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| data                       | Standard Request Data body for this request, encoded as utf-8 JSON. Note that this includes the envelope |
| saveGameFile               | File attachment containing the save game file. Contents of the file will be validated on the server      |

Function Request Data:

| Property Name               | Property Type            | Description                                                                 |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| SaveName                    | string                   | Name of the save game file to create on the Dedicated Server                |
| LoadSaveGame                | boolean                  | True if save game file should be immediately loaded by the Dedicated Server |
| EnableAdvancedGameSettings  | boolean                  | True if save game file should be loaded with Advanced Game Settings enabled |

Possible errors:

| Error Code                 | Description                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| invalid_save_game          | Invalid save game file encoding, malformed header or corrupted contents                                 |
| unsupported_save_game      | Save game file is too old to be loaded by the Dedicated Server, or is too new                           |
| file_save_failed           | Failed to save the save game file to the underlying file system                                         |
| save_game_load_failed      | Failed to find the created save game file                                                               |
```
