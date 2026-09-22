Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getBelts.html
Captured: 2026-09-21

---

## Get Belts

Get a list of all belts.

## Response Body

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| ID | String | Unique ID of the Belt. |
| Name | String | Name of the Belt Type. |
| ClassName | String | Class Name of the Belt. |
| ColorSlot | Object | Color/Decoration information about the Actor. |
| PrimaryColor | String | Hex Code of Primary Color |
| SecondaryColor | String | Hex Code of Secondary Color |
| BoundingBox | Object | Bounding Box information about the Actor. |
| min | Object | The minimum boundary of the bounding box in the corresponding axis. |
| x | Float | Value along the X-axis. |
| y | Float | Value along the Y-axis. |
| z | Float | Value along the Z-axis. |
| max | Object | The maximum boundary of the bounding box in the corresponding axis. |
| x | Float | Value along the X-axis. |
| y | Float | Value along the Y-axis. |
| z | Float | Value along the Z-axis. |
| BoundingBox | Object | Bounding Box information about the Actor. |
| min | Object | The minimum boundary of the bounding box in the corresponding axis. |
| x | Float | Value along the X-axis. |
| y | Float | Value along the Y-axis. |
| z | Float | Value along the Z-axis. |
| max | Object | The maximum boundary of the bounding box in the corresponding axis. |
| x | Float | Value along the X-axis. |
| y | Float | Value along the Y-axis. |
| z | Float | Value along the Z-axis. |
| SplineData | Object | Spline Information for Actor. |
| x | Float | Value along the X-axis. |
| y | Float | Value along the Y-axis. |
| z | Float | Value along the Z-axis. |
| location0 | Object | Start Location of the Belt |
| x | Float | X Location in the World. |
| y | Float | Y Location in the World. |
| z | Float | Z Location in the World. |
| Connected0 | Boolean | Is Belt Connected at starting point? |
| location1 | Object | End Location of the Belt |
| x | Float | X Location in the World. |
| y | Float | Y Location in the World. |
| z | Float | Z Location in the World. |
| Connected1 | Boolean | Is Belt Connected at ending point? |
| Length | Float | Length of the Belt in centimetre (cm). |
| ItemsPerMinute | Float | Speed of the Belt. |
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
    "ID": "Build_ConveyorBeltMk1_C_2147415070",
    "Name": "Conveyor Belt Mk.1",
    "ClassName": "Build_ConveyorBeltMk1_C",
    "location0": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "Connected0": true,
    "location1": {
      "x": -964.5940059659988,
      "y": -258.68724653875688,
      "z": 27.264452340796197
    },
    "Connected1": true,
    "Length": 1000.2387084960938,
    "ItemsPerMinute": 60,
    "features": {
      "properties": {
        "name": "Conveyor Belt Mk.1",
        "type": "Conveyor Belt Mk.1"
      },
      "geometry": {
        "coordinates": {
          "x": -54853.11328125,
          "y": 263822.28125,
          "z": -3733.415771484375
        },
        "type": "Point"
      }
    }
  }
]
```