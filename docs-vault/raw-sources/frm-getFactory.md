Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getFactory.html
Captured: 2026-09-21. Trimmed 2026-09-27 (#343).

FicsitRemoteMonitoring's docs carry no licence (all rights reserved), so this file keeps only the
excerpts this repo cites, verbatim, numbered E1, E2, ... Cite them as `frm-getFactory.md` E<n>, never by line
number. The full page is at the source URL; a full copy of the 2026-09-21 capture is kept outside
the repo, and this file's git history has it too.
Not excerpted: the table's ColorSlot, BoundingBox and features rows.

---

### E1 — What the endpoint returns, and the per-type variants

## Get Factory

Get a list of all factory buildings.

getAssembler only retrieves Assemblers  
getBlender only retrieves Blenders  
getConstructor only retrieves Constructors  
getParticle only retrieves Particle Accelerators  
etc.

### E2 — Identity and location (x, y, z, rotation)

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

### E3 — Recipe and production[] (Amount documented as String, CurrentProd, MaxProd, ProdPercent)

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| Recipe | String | Name of the item being produced. |
| RecipeClassName | String | ClassName of the item being produced. |
| production | Object\[\] | List of produced items. |
| Name | String | Name of the item. |
| ClassName | String | ClassName of the item. |
| Amount | String | Number of items to be produced. |
| CurrentProd | Float | Current production rate per minute (amount decreases if an ingredient is unavailable). |
| MaxProd | Float | Maximum items produced per minute. |
| ProdPercent | Float | Efficiency Percentage. |

### E4 — ingredients[]

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| ingredients | Object\[\] | List of required items. |
| Name | String | Name of the item. |
| ClassName | String | ClassName of the item. |
| Amount | String | Number of items required for product. |
| CurrentConsumed | Float | Current consumption rate per minute (amount decreases if an ingredient is unavailable). |
| MaxConsumed | Float | Maximum items consumed per minute. |
| ConsPercent | Float | Efficiency Percentage. |

### E5 — InputInventory[] and OutputInventory[] (Amount, MaxAmount)

| **Name** | **Type** | **Description** |
| --- | --- | --- |
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

### E6 — ManuSpeed, Somersloops, PowerShards, IsConfigured, IsProducing, IsPaused

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| ManuSpeed | Float | Configured speed in % (exceeds 100 if the machine is equipped with a power slug). |
| Somersloops | Integer | Number of Somersloops in the machine. |
| PowerShards | Integer | Number of Power Shards in the machine. |
| IsConfigured | Boolean | Is a recipe configured? |
| IsProducing | Boolean | Is the building producing now? |
| IsPaused | Boolean | Is paused? |

### E7 — PowerInfo

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| PowerInfo | Object | Power Information Object. |
| CircuitGroupID | Integer | The group this circuit belongs too. (-1 = not connected) |
| CircuitID | Integer | This circuit’s unique identifier. (-1 = not connected) |
| FuseTriggered | Boolean | Has the fuse tripped? |
| PowerConsumed | Float | Current power consumption. |
| MaxPowerConsumed | Float | Current maximum power consumption. |
