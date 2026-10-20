- 2026-10-20 — Server manager 3/4 (#439, ADR-0040): an Agent panel in the window. It shows the "Satisfactory Dash Agent"
  Scheduled Task's state (running, ready, disabled, missing) read every 3 s through System32 PowerShell's
  `Get-ScheduledTask` with a fixed script (`server-manager/src/agentTask.ts`), with Start and Stop buttons
  (`Start-`/`Stop-ScheduledTask`); a missing task shows a link main opens to the runbook's "Keeping it running" (one
  fixed URL; the window sends none). It shows the newest 20 lines of the agent's current day log as written
  (`src/agentLog.ts`; a line still being written stays out), the halted marker's reason and fix with a Resume button
  (`src/agentHalted.ts`, read-only), and Check and Status buttons that run the built agent's `check` and `status`
  (`src/agentProcess.ts`; `set-tokens` and `enroll` stay in a console). Under the e2e switch both programs are
  `e2e/fake-agent.cjs`, so `e2e/agent.spec.ts` never reaches the real Task Scheduler or agent. The agent is unchanged.
