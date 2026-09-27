Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/getSessionInfo.html
Captured: 2026-09-21. Trimmed 2026-09-27 (#343).

FicsitRemoteMonitoring's docs carry no licence (all rights reserved), so this file keeps only the
excerpts this repo cites, verbatim, numbered E1, E2, ... Cite them as `frm-getSessionInfo.md` E<n>, never by line
number. The full page is at the source URL; a full copy of the 2026-09-21 capture is kept outside
the repo, and this file's git history has it too.
Not excerpted: the Seed row and the example response.

---

### E1 — What the endpoint returns (runs in the game thread)

## Get Session Info

This endpoint runs in game thread.

Gets information about the current session.

### E2 — Response body (most descriptions are the copy-pasted "Save Name currently running")

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
