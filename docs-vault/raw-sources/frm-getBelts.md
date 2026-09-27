Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getBelts.html
Captured: 2026-09-21. Trimmed 2026-09-27 (#343).

FicsitRemoteMonitoring's docs carry no licence (all rights reserved), so this file keeps only the
excerpts this repo cites, verbatim, numbered E1, E2, ... Cite them as `frm-getBelts.md` E<n>, never by line
number. The full page is at the source URL; a full copy of the 2026-09-21 capture is kept outside
the repo, and this file's git history has it too.
Not excerpted: the table's ColorSlot, BoundingBox, SplineData and features rows, and the example
response. None of the table's rows describes items on the belt or how full it is.

---

### E1 — What the endpoint returns

## Get Belts

Get a list of all belts.

### E2 — Identity, both ends, Length and ItemsPerMinute (the belt's speed)

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| ID | String | Unique ID of the Belt. |
| Name | String | Name of the Belt Type. |
| ClassName | String | Class Name of the Belt. |
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
