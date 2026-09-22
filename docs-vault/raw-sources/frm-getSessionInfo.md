Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getSessionInfo.html
Captured: 2026-09-21

---

## Get Session Info

This endpoint runs in game thread.

Gets information about the current session.

## Response Body

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| SessionName | String | Save Name currently running. |
| IsPaused | Boolean | Is the game currently paused (effective on dedicated servers). |
| DayLength | Integer | Save Name currently running. |
| NightLength | Integer | Save Name currently running. |
| PassedDays | Integer | Save Name currently running. |
| NumberOfDaysSinceLastDeath | Integer | Number Of Days Since Last Death. |
| Hours | Integer | Save Name currently running. |
| Minutes | Integer | Save Name currently running. |
| Seconds | Float | Save Name currently running. |
| IsDay | Boolean | Save Name currently running. |
| TotalPlayDuration | Integer | Duration in Seconds. |
| TotalPlayDurationText | String | Duration in Hours:Minutes:Seconds. |
| Seed | Integer | Seed Number for World.  \== Example Response \[source,json\] ----------------- { "SessionName": "SML-1.2.Test", "IsPaused": false, "DayLength": 50, "NightLength": 10, "PassedDays": 0, "NumberOfDaysSinceLastDeath": 0, "Hours": 13, "Minutes": 31, "Seconds": 54.6875, "IsDay": true, "TotalPlayDuration": 510, "TotalPlayDurationText": "00:08:30", "Seed": 396373824 } ----------------- |