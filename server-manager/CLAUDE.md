# server-manager/

See the root `CLAUDE.md` for project-wide rules and `docs-vault/wiki/decisions/0040-server-manager-holdover.md` for why
this exists. It is an Electron app for the owner's PC only (no installer, no signing, no auto-update) that starts and
supervises the dedicated server, a holdover until the mod.

## Rules

- **It opens no port and runs as the user.** The window is a local file; nothing listens
  (`e2e/no-listen.spec.ts`).
- **It only runs the configured `FactoryServer.exe` and the configured `steamcmd.exe`, each with fixed arguments and
  no shell** (`src/supervisor.ts` `SERVER_ARGS`, `src/updater.ts` `steamcmdArgs`, `src/serverProcess.ts`). The one
  other process is PowerShell (Windows) or `ps`, with a fixed script, to read the server's CPU and memory
  (`src/processStats.ts`); the pid goes in the environment, never into the script. The agent's DPAPI store also runs
  PowerShell to unprotect the token, with the agent's own fixed script (`agent/src/dpapi.ts`).
  `SATISFACTORY_SERVER_MANAGER_TEST_RUN_WITH_NODE=1` is the e2e switch that runs the same configured file as a Node
  script; it never changes which file runs.
- **Stop is the clean stop** (`src/supervisor.ts`, `src/gameApi.ts`): `QueryServerState` for the session name,
  `SaveGame`, then `Shutdown` through the game's own API, ended after 60 s if it's still there. The API token is the
  agent's (`src/gameAccess.ts` opens `AgentStore` from `@satisfactory-dash/agent`; `SD_AGENT_HOME` moves it for tests).
  It goes only into the API request: never to the window, a log or an error message (`src/preload.test.ts`). With no
  token, Stop offers "Stop anyway".
- **Never a second server.** Quitting leaves the server running and the app doesn't adopt it yet, so it records the
  running server's pid in `server.pid` beside the settings; while that process lives, Start is refused
  (`src/leftoverServer.ts`).
- **The window gets only the bridge** in `src/ipc.ts` (`contextIsolation` on, `nodeIntegration` off, a sandboxed
  preload, a strict CSP in `src/renderer/index.html`). Main answers IPC only from its own page.
- **Settings** live in `%LOCALAPPDATA%\satisfactory-dash-server-manager\settings.json` (`src/settings.ts`, zod);
  `SATISFACTORY_SERVER_MANAGER_DATA_DIR` moves them for tests. No machine path is ever committed.
- **Look:** the dashboard's design tokens. `scripts/build.mjs` generates `tokens.css` from the `@theme` block in
  `frontend/src/index.css`; `src/renderer/styles.css` uses only those variables for colour, radius, size and motion.

## Commands

- `npm run build -w server-manager`, then `npm start -w server-manager` opens the window.
- `npm run test -w server-manager`: the unit tests (Vitest).
- `npm run e2e -w server-manager`: builds, then drives the app with Playwright against the fake server in
  `e2e/fake-server.cjs` (on Linux, under `xvfb-run`).
