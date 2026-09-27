- 2026-09-27 — Backend + scripts/windows: issue #320, proving a deploy's readiness 200 comes from
  the NEW build (design note option C: a purely local proof, no public exposure, no contract
  change). `backend/scripts/build.mjs` replaces the plain esbuild CLI call, baking the real commit
  in via `--define:BUILD_COMMIT` (`git rev-parse HEAD`, falling back to `"unknown"` if git or `.git`
  is missing); `backend/src/platform/buildInfo.ts` reads it safely outside a bundle too (`typeof` on
  an undeclared identifier never throws). `backend/src/platform/runFile.ts` writes
  `<RUN_FILE_DIR>/backend.json` = `{commit, pid, startedAt}` atomically (temp file, then rename)
  once the server is listening, only when `RUN_FILE_DIR` is set; `server.ts` calls it and logs the
  commit once at startup. `scripts/windows/run-backend.ps1` gains `-RunFileDir` (sets
  `RUN_FILE_DIR` for the node process it launches); `register-backend-task.ps1` gains the same
  parameter (default `%LOCALAPPDATA%\satisfactory-dash\run`) and passes it through to the wrapper.
  `deploy-update.ps1`, after its readiness wait, now also reads the run file and requires its
  `commit` to equal the deployed SHA and its `startedAt` (parsed as UTC) to be later than the
  restart it just issued (captured as UTC too, to compare correctly); either mismatch fails the
  deploy with the task state and the log tail, same as a readiness timeout. Not executable in this
  session (PowerShell doesn't run here); the `.ps1` changes are unexecuted pending the owner's next
  deploy (`-WhatIf` first), per the design note's own admission.
