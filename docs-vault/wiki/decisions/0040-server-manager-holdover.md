# ADR-0040: The server manager, an Electron holdover until the mod

Status: accepted (owner, 2026-10-19) for issue #436. The design was approved by the owner on
2026-10-19; this ADR records it. The build tasks that follow are blocked by #436 and define their
own interface contracts.

## Context
- **How the owner runs the game server today.**
  - It starts from a one-line PowerShell script that runs `FactoryServer.exe -log` in the server
    folder.
  - It is updated by hand with SteamCMD (app 1690800, anonymous login; `wiki/log.md`, the spike of
    2026-09-21).
  - The agent (ADR-0031) runs beside it as the "Satisfactory Dash Agent" Scheduled Task
    (`runbooks/agent-app.md`, "Keeping it running: a Scheduled Task").
- **The mod is not close.** The agent becomes a mod only after ADR-0039's gates (G0-G2) pass and the
  owner approves a G3 build ADR. Until then the owner babysits a script and a Scheduled Task.
- **What the owner wants:** one app instead of the script, which runs the server and watches the
  agent, as a holdover until the mod.

## Options
| | What | Upside | Cost / risk |
|---|---|---|---|
| **A** | **Electron**: a window and a tray icon | All TypeScript, like the rest of the repo; testable with Playwright; a tray icon keeps it out of the way | About 100 MB on disk; one more workspace to build |
| **B** | A local web page served by a single Node executable | Small; reuses the frontend's stack | No tray; closing the tab hides the controls; a local web page means a listening port |
| **C** | Tauri | Small binary; a real tray | A Rust backend: a new language for a holdover |

## Decision
1. **Electron (option A), for the owner's PC only.**
   - A new npm workspace `server-manager/`, built from the checkout like the agent.
   - No installer, no signing, no auto-update. ADR-0031's "first other player" trigger covers
     packaging for anyone else.
2. **Game server.**
   - **Start:** `FactoryServer.exe -log` as a supervised child process, with no shell.
   - **Stop:** ask the server to save, then shut down, through its HTTPS API (`SaveGame` then
     `Shutdown`, `wiki/vanilla-dedicated-server-api.md`), with the application token the agent
     already stores. The process is killed only after a timeout, and the app says so.
   - **Restart:** stop, then start.
   - **Update** through SteamCMD: stop, run
     `+force_install_dir <server folder> +login anonymous +app_update 1690800 validate +quit`, show
     the output, and offer to start.
   - **After a crash:** restart at most 3 times in 10 minutes, then stop and show why.
3. **Agent.**
   - It stays a Scheduled Task; its DPAPI store and its security are unchanged.
   - The app shows the task's state and the agent's newest log lines (codes and counts only),
     starts and stops the task, and runs the agent's `check` and `status`.
4. **Status.**
   - The window shows the server's state, players and uptime, CPU and memory, and the agent's state.
   - The tray icon is green while running, amber while starting or stopping, red when stopped or
     crashed.
   - Closing the window keeps the app in the tray. Quit leaves the server running unless "Stop
     server and quit" is chosen.
5. **Settings** (server folder, SteamCMD folder, start with Windows) live under `%LOCALAPPDATA%`,
   set in the app on first run. **No machine path is ever committed.**
6. **Safety.**
   - It runs as the user (no elevation) and opens no port.
   - It never shows or logs a token.
   - It only ever runs the server binary and SteamCMD from the configured folders, with fixed
     arguments.
7. **Look:** the dashboard's design tokens. The planned style review restyles both together.

## Consequences
- One more workspace to keep building. Electron's size (about 100 MB) is accepted for one PC.
- Tests use a fake server binary and a fake SteamCMD, so CI never needs the game.
- The agent and its security model are untouched: the app drives the Scheduled Task, not the agent's
  store.

## Revisit when
- The mod replaces the agent (ADR-0039 G3).
- A second player wants it (ADR-0031's "first other player").

## For the portfolio case study
The owner ran a dedicated game server from a one-line script and a Scheduled Task, and had to
babysit both: start, update by hand, notice crashes. The server manager replaces that with one small
Electron app with a tray icon, chosen deliberately as a holdover until the mod, not as a product:
it is for one PC, with no installer and no updates. Its guards are the interesting part: a clean
save-then-shutdown through the game's own API before any kill, a crash back-off that gives up after
3 restarts in 10 minutes and says why, and no secrets anywhere in the UI or its logs. See the
runbook and the screenshots that the last build task adds [link added by that task].
