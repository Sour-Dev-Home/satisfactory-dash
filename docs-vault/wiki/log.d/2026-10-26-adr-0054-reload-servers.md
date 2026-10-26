- 2026-10-26 — ADR-0054 D3.10 (amendment, owner's pick: reload on leadership). Building PR 3 found that each task's
  server runtime is loaded once at startup, so a server write handled by the old task during a deploy's overlap would
  be missing from the new task until its next restart. A task that takes the leader lock now reconciles its runtime
  with the database first (`reconcileDatabaseServers`), changing only what differs; polled entries carry a digest of
  their connection (`connectionSource`). This ships and deploys before PR 3 (#705).
