---
area: general
pattern: supervisor-forgets-detached-child
severity: important
reviewer: architecture-advisor
source: "#437"
---

When a supervisor deliberately leaves its child running on quit (the server manager keeps the game server up when the app closes), its next launch starts with no memory of that child, so a plain Start launches a duplicate that fights the first for its ports and then trips the crash back-off. Record the child's pid where the next launch can read it (`server-manager/src/leftoverServer.ts` writes `server.pid` beside the settings), refuse Start and Restart in the main process while that pid is alive, and drop a stale or malformed record. A pid can be reused, so before adopting or killing it, check that it really is the expected program.
