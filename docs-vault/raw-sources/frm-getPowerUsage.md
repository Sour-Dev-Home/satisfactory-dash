Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getPowerUsage.html
Captured: 2026-09-21

---

## Get Power Usage

Gets a list of buildings with power usage.

## Response Body

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| ID | String | Unique ID of the Factory Building. |
| Name | String | Name of the Factory Building. |
| ClassName | String | ClassName of the Factory Building. |
| location | Object | Location details of the Factory Building. |
| x | Float | X Location in the World. |
| y | Float | Y Location in the World. |
| z | Float | Z Location in the World. |
| rotation | Float | Rotation of the Actor (0 - 359, 0 = North, 90 = East, 180 = South, 270 = West). |
| PowerInfo | Object | Power Information Object. |
| CircuitGroupID | Integer | The group this circuit belongs too. (-1 = not connected) |
| CircuitID | Integer | This circuit’s unique identifier. (-1 = not connected) |
| FuseTriggered | Boolean | Has the fuse tripped? |
| PowerConsumed | Float | Current power consumption. |
| MaxPowerConsumed | Float | Current maximum power consumption. |

## Example Response

```json
[
 {
    "ID": "Build_OilRefinery_C_2147345255",
    "Name": "Refinery",
    "ClassName": "Build_OilRefinery_C",
    "location": {
      "x": 151500,
      "y": 214300,
      "z": -7499.9814453125,
      "rotation": 90
    },
    "PowerInfo": {
      "CircuitGroupID": -1,
      "CircuitID": -1,
      "FuseTriggered": false,
      "PowerConsumed": 0,
      "MaxPowerConsumed": 0
    }
  },
  {
    "ID": "Build_OilRefinery_C_2147345106",
    "Name": "Refinery",
    "ClassName": "Build_OilRefinery_C",
    "location": {
      "x": 150500,
      "y": 214300,
      "z": -7499.9814453125,
      "rotation": 90
    },
    "PowerInfo": {
      "CircuitGroupID": -1,
      "CircuitID": -1,
      "FuseTriggered": false,
      "PowerConsumed": 0,
      "MaxPowerConsumed": 0
    }
  }
]
```