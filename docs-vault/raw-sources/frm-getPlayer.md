Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getPlayer.html
Captured: 2026-09-21

---

## Get Player

Get a list of all Players.

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
| features | Object | An object with actor coordinates and name information. |
| properties | Object | Name information about the actor. |
| name | String | Display Name of the Actor. |
| type | String | Type of the Object. |
| geometry | Object | Geometry information about the Actor. |
| coordinates | Object | The Actor coordinates. |
| x | Float | X Location of the Actor. |
| y | Float | Y Location of the Actor. |
| z | Float | Z Location of the Actor. |
| type | String | It’s always "Point". |

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
    "Inventory": [
      {
        "Name": "Beryl Nut",
        "ClassName": "Desc_Nut_C",
        "Amount": 10,
        "MaxAmount": 100
      },
      {
        "Name": "Paleberry",
        "ClassName": "Desc_Berry_C",
        "Amount": 50,
        "MaxAmount": 50
      },
      {
        "Name": "FICSIT Coupon",
        "ClassName": "Desc_ResourceSinkCoupon_C",
        "Amount": 11,
        "MaxAmount": 500
      },
      {
        "Name": "Hard Drive",
        "ClassName": "Desc_HardDrive_C",
        "Amount": 48,
        "MaxAmount": 100
      },
      {
        "Name": "Mercer Sphere",
        "ClassName": "Desc_WAT2_C",
        "Amount": 1,
        "MaxAmount": 50
      },
      {
        "Name": "Wood",
        "ClassName": "Desc_Wood_C",
        "Amount": 51,
        "MaxAmount": 200
      },
      {
        "Name": "Hoverpack",
        "ClassName": "BP_EquipmentDescriptorHoverPack_C",
        "Amount": 1,
        "MaxAmount": 1
      }
    ],
    "features": {
      "properties": {
        "name": "derpierre65",
        "type": "Player"
      },
      "geometry": {
        "coordinates": {
          "x": -57604.6796875,
          "y": 260436.1875,
          "z": -3018.36083984375
        },
        "type": "Point"
      }
    }
  }
]
```