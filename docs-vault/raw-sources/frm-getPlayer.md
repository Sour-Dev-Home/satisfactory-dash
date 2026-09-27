Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getPlayer.html
Captured: 2026-09-21. Trimmed 2026-09-27 (#343).

FicsitRemoteMonitoring's docs carry no licence (all rights reserved), so this file keeps only the
excerpts this repo cites, verbatim, numbered E1, E2, ... Cite them as `frm-getPlayer.md` E<n>, never by line
number. The full page is at the source URL; a full copy of the 2026-09-21 capture is kept outside
the repo, and this file's git history has it too.
Not excerpted: the table's features rows.

---

### E1 — What the endpoint returns

## Get Player

Get a list of all Players.

### E2 — Response body: ID, Name, location, PlayerHP, Speed, Online, Dead, Inventory

## Response Body

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| ID | String | Unique ID of the Player. |
| Name | String | Name of the Player. |
| ClassName | String | Class Name of the Player. |
| location | Object | Location of the Player. |
| x | Float | X Location in the World. |
| y | Float | Y Location in the World. |
| z | Float | Z Location in the World. |
| rotation | Float | Rotation of the Actor (0 - 359, 0 = North, 90 = East, 180 = South, 270 = West). |
| PlayerHP | Float | HP of the Player. |
| Speed | Float | Speed of the Player. |
| Online | Boolean | Is the player online? |
| Dead | Boolean | Is the player dead? |
| Inventory | Object\[\] | A list of items. |
| Name | String | Name of the item. |
| ClassName | String | Class Name of the item. |
| Amount | Integer | Amount of the item. |
| MaxAmount | Integer | Stack size of the item. |

### E3 — Example response, up to the Inventory (its items and the features object are not excerpted)

## Example Response

```json
[
  {
    "ID": "Char_Player_C_2147452680",
    "Name": "derpierre65",
    "ClassName": "Char_Player_C",
    "location": {
      "x": -57604.6796875,
      "y": 260436.1875,
      "z": -3018.36083984375,
      "rotation": 115.5536737696151
    },
    "Online": true,
    "PlayerHP": 100,
    "Dead": false,
