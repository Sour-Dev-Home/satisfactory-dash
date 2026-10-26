- 2026-10-26 — ADR-0054 D3.10, an amendment: the owner chose "reload on leadership".
  - The gap: building PR 3 found that each task's server runtime is loaded once at startup. A server write handled by
    the old task during a deploy's overlap would be missing from the new task until its next restart.
  - A task that takes the leader lock now reconciles its runtime with the database first (`reconcileDatabaseServers`),
    changing only what differs. Polled entries carry a digest of their connection (`connectionSource`).
  - Shutdown releases the lock only after the HTTP server has closed (`platform/shutdown.ts`), so no late write
    escapes the reload.
  - The reload is bounded at 5 s. An unreadable row keeps a running server. In database mode an empty database
    removes everything (a test-hunter find).
  - Ships and deploys before PR 3 (#705).
