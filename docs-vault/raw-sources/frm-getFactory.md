Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getFactory.html
Captured: 2026-09-21

---

## Get Factory

Get a list of all factory buildings.

getAssembler only retrieves Assemblers  
getBlender only retrieves Blenders  
getConstructor only retrieves Constructors  
getParticle only retrieves Particle Accelerators  
etc.

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
| Recipe | String | Name of the item being produced. |
| RecipeClassName | String | ClassName of the item being produced. |
| production | Object\[\] | List of produced items. |
| Name | String | Name of the item. |
| ClassName | String | ClassName of the item. |
| Amount | String | Number of items to be produced. |
| CurrentProd | Float | Current production rate per minute (amount decreases if an ingredient is unavailable). |
| MaxProd | Float | Maximum items produced per minute. |
| ProdPercent | Float | Efficiency Percentage. |
| ingredients | Object\[\] | List of required items. |
| Name | String | Name of the item. |
| ClassName | String | ClassName of the item. |
| Amount | String | Number of items required for product. |
| CurrentConsumed | Float | Current consumption rate per minute (amount decreases if an ingredient is unavailable). |
| MaxConsumed | Float | Maximum items consumed per minute. |
| ConsPercent | Float | Efficiency Percentage. |
| InputInventory | Object\[\] | A list of items in the input inventory. |
| Name | String | Name of the item. |
| ClassName | String | Class Name of the item. |
| Amount | Integer | Amount of the item. |
| MaxAmount | Integer | Stack size of the item. |
| OutputInventory | Object\[\] | A list of items in the output inventory. |
| Name | String | Name of the item. |
| ClassName | String | Class Name of the item. |
| Amount | Integer | Amount of the item. |
| MaxAmount | Integer | Stack size of the item. |
| ManuSpeed | Float | Configured speed in % (exceeds 100 if the machine is equipped with a power slug). |
| Somersloops | Integer | Number of Somersloops in the machine. |
| PowerShards | Integer | Number of Power Shards in the machine. |
| IsConfigured | Boolean | Is a recipe configured? |
| IsProducing | Boolean | Is the building producing now? |
| IsPaused | Boolean | Is paused? |
| PowerInfo | Object | Power Information Object. |
| CircuitGroupID | Integer | The group this circuit belongs too. (-1 = not connected) |
| CircuitID | Integer | This circuit’s unique identifier. (-1 = not connected) |
| FuseTriggered | Boolean | Has the fuse tripped? |
| PowerConsumed | Float | Current power consumption. |
| MaxPowerConsumed | Float | Current maximum power consumption. |
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
    "ID": "Build_ConstructorMk1_C_2147415548",
    "Name": "Constructor",
    "ClassName": "Build_ConstructorMk1_C",
    "location": {
      "x": -70700,
      "y": 254500,
      "z": -3599.984130859375,
      "rotation": 90
    },
    "Recipe": "Concrete",
    "RecipeClassName": "Recipe_Concrete_C",
    "production": [
      {
        "Name": "Concrete",
        "ClassName": "Desc_Cement_C",
        "Amount": 33,
        "CurrentProd": 0,
        "MaxProd": 1.649999976158142,
        "ProdPercent": 0
      }
    ],
    "ingredients": [
      {
        "Name": "Limestone",
        "ClassName": "Desc_Stone_C",
        "Amount": 1,
        "CurrentConsumed": 0,
        "MaxConsumed": 4.949999809265137,
        "ConsPercent": 0
      }
    ],
    "Productivity": 0,
    "ManuSpeed": 100,
    "IsConfigured": true,
    "IsProducing": false,
    "IsPaused": true,
    "PowerInfo": {
      "CircuitGroupID": 0,
      "CircuitID": 1,
      "PowerConsumed": 0.10000000149011612,
      "MaxPowerConsumed": 0.21619677543640137
    },
    "features": {
      "properties": {
        "name": "Constructor",
        "type": "Constructor"
      },
      "geometry": {
        "coordinates": {
          "x": -70700,
          "y": 254500,
          "z": -3599.984130859375
        },
        "type": "Point"
      }
    }
  }
]
```