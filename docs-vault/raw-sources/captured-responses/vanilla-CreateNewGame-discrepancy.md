Captured: 2026-09-21, live server, GameVersion 1.2.4.0, CL 502094
Method: POST https://localhost:7777/api/v1  body: {"function":"CreateNewGame","data":{"NewGameData":{"SessionName":"x","MapName":"","StartingLocation":"","SkipOnboarding":true,"AdvancedGameSettings":{},"CustomOptionsOnlyForModding":{}}}}
(fields exactly as documented in dedicated-server-api.md's CreateNewGame/ServerNewGameData section)

---

{"errorCode":"missing_params","errorMessage":"The Request is missing the Required Parameters needed to Execute the Function, or they are in the Invalid Format.\nInvalid Parameters:\nnewGameData: Unable to import JSON object into FGServerNewGameData property NewGameData\nMissing JSON value named bSkipOnboarding\nMissing Parameters:\n\nAdditional Errors:\n","errorData":{"missingParameters":[],"invalidParameters":{"newGameData":"Unable to import JSON object into FGServerNewGameData property NewGameData\nMissing JSON value named bSkipOnboarding"}}}

Then retried with bSkipOnboarding (Unreal's actual bool-prefixed field name) instead of the documented SkipOnboarding:

{"errorCode":"missing_params","errorMessage":"...Missing JSON value named GameModeSettings...","errorData":{"invalidParameters":{"newGameData":"...Missing JSON value named GameModeSettings"}}}

GameModeSettings is not documented anywhere in dedicated-server-api.md's ServerNewGameData table. Succeeded (HTTP 202) once an empty GameModeSettings object was added:
{"NewGameData":{"SessionName":"docs-vault-spike","MapName":"","StartingLocation":"","bSkipOnboarding":true,"AdvancedGameSettings":{},"GameModeSettings":{},"CustomOptionsOnlyForModding":{}}}
