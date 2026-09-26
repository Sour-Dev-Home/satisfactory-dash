# agent/

See the root `CLAUDE.md` for project-wide rules and `docs-vault/wiki/runbooks/agent-app.md` for how it is set up and run.
This is the edge agent (ADR-0031 PR 6): it runs on a player's Windows PC beside their game server, reads the game over
loopback, pushes snapshots OUT to the backend and runs the commands the dashboard asks for. It opens no port.

## Rules (each one is enforced by a test, so a change that breaks it fails CI)

- **Imports only** `node:*`, `zod`, `@satisfactory-dash/shared` and `@satisfactory-dash/game-adapter` (bare). No Express,
  database, backend or frontend path, no HTTP library beyond node's `fetch` (`src/boundaries.test.ts`). What the agent
  pulls in is part of what a player must trust.
- **Secrets**: the agent's credential and the game's tokens live ONLY as DPAPI blobs (`src/store.ts`, `src/dpapi.ts`). A
  plaintext goes to PowerShell ONLY on stdin, never in an argument or the environment. Tokens are typed at a hidden prompt,
  never accepted as arguments or read from the environment. A secret that cannot be unprotected is a loud error, never an
  empty value.
- **Logs** carry codes and counts only (`src/logger.ts` enforces it at runtime): never a secret, a token, a snapshot body or
  a player name. Any new field must be a number, a boolean or a short plain code.
- **The backend never gets a redirect to follow**: `redirect: "manual"`, https only (http only for localhost), a timeout on
  every request (`src/backendClient.ts`). A 401 stops the agent; it never retries a rejected credential.
- **The agent sends raw readings only.** No circuit `status`, machine `state`, counts or `unit`: those are the backend's rules
  (`backend/src/modules/telemetry/services/snapshotDerive.ts`), so a rule change never needs an agent update. The shape
  mapping is the game-adapter package's (`snapshot/`), shared with the backend.
- **Readings are conformed to the backend's input bounds before sending** (`src/conform.ts`): the backend refuses a whole
  snapshot for one bad value, so the agent cuts, clamps and drops instead. Change the contract's bounds in
  `packages/shared/src/agent.ts` first (a contract change: its own PR).
- **Commands are idempotent and de-duplicated by id until their expiry** (`src/ledger.ts`, `src/commandRunner.ts`); results
  are codes from the contract's fixed list, never free text.
- Tests: `npm run test -w agent`. The real-DPAPI round trips run only on Windows (CI is Linux, so it skips them); run them on
  the Windows dev machine before changing `dpapi.ts`.
