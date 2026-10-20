/**
 * The server manager's main process (ADR-0040). It owns the supervisor and the settings and answers the window's
 * few IPC calls. It opens no port and needs no elevation: the window is a local file, and the processes it starts are
 * the configured FactoryServer.exe and, for an update, the configured steamcmd.exe (plus PowerShell or ps to read the
 * server's CPU and memory). The clean stop talks to the game's own API with the agent's token, read here and never sent
 * to the window.
 */
import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gameApiAccess, openAgentStore } from "./gameAccess";
import { anywayRequested, CHANNELS, type AnywayAction, type ChooseResult, type Status } from "./ipc";
import { cpuPercent, sampleProcess } from "./processStats";
import { clearPid, leftoverPid, processAlive, recordPid } from "./leftoverServer";
import { serverSpawn } from "./serverProcess";
import { runUpdate } from "./updater";
import {
  hasServerExe,
  hasSteamcmdExe,
  loadSettings,
  saveSettings,
  SERVER_EXE,
  settingsDir,
  type Settings,
} from "./settings";
import { createSupervisor, type Supervisor } from "./supervisor";

const STATUS_INTERVAL_MS = 3000;
const indexFile = join(__dirname, "renderer", "index.html");
const indexUrl = pathToFileURL(indexFile).href;

let settings: Settings | undefined;
let supervisor: Supervisor | undefined;
let currentPid: number | undefined;
let runningSince: number | undefined;
let lastSample: { pid: number; cpuSeconds: number; at: number } | undefined;
let usage: { cpuPercent: number | undefined; memoryBytes: number | undefined } = {
  cpuPercent: undefined,
  memoryBytes: undefined,
};
let win: BrowserWindow | undefined;
let anyway: AnywayAction | undefined;
let updating = false;
let updateResult: { ok: boolean; code: number } | undefined;

function configured(): boolean {
  return settings !== undefined && hasServerExe(settings.serverDir);
}

/** The pid file is a guard, not the supervisor's state: a disk error writing it must not break a running server. */
function bestEffort(fn: () => void): void {
  try {
    fn();
  } catch {
    // Without the file the next launch just can't spot a leftover server.
  }
}

function makeSupervisor(serverDir: string): Supervisor {
  const spawn = serverSpawn({ env: process.env, execPath: process.execPath });
  const sup = createSupervisor({
    spawn: (exe, args) => {
      const child = spawn(exe, args);
      currentPid = child.pid;
      child.onSpawn(() => {
        currentPid = child.pid;
        bestEffort(() => recordPid(settingsDir(), child.pid));
      });
      return child;
    },
    now: Date.now,
    serverExe: join(serverDir, SERVER_EXE),
    gameApi: () => gameApiAccess({ openStore: openAgentStore }),
  });
  sup.onChange((state) => {
    // An offer to stop without saving is about the process that was running; any other state ends it.
    if (state !== "running") anyway = undefined;
    if (state === "stopped" || state === "crashed") bestEffort(() => clearPid(settingsDir()));
    if (state === "running") runningSince = Date.now();
    else {
      runningSince = undefined;
      usage = { cpuPercent: undefined, memoryBytes: undefined };
      lastSample = undefined;
    }
    pushStatus();
  });
  return sup;
}

/** A server an earlier session of the app started and left running; only checked while ours isn't running. */
function leftover(): number | undefined {
  const state = supervisor?.state() ?? "stopped";
  if (state !== "stopped" && state !== "crashed") return undefined;
  return leftoverPid(settingsDir(), processAlive);
}

function status(): Status {
  const state = supervisor?.state() ?? "stopped";
  const running = state === "running";
  const leftoverServer = leftover();
  return {
    state,
    lastError:
      leftoverServer !== undefined
        ? `A server this app started earlier is still running (process ${leftoverServer}). This version can't control it: end it in Task Manager (or wait for it to stop), and Start comes back.`
        : supervisor?.lastError(),
    leftoverPid: leftoverServer,
    configured: configured(),
    serverDir: settings?.serverDir,
    steamcmdDir: settings?.steamcmdDir,
    uptimeMs: running && runningSince !== undefined ? Date.now() - runningSince : undefined,
    cpuPercent: running ? usage.cpuPercent : undefined,
    memoryBytes: running ? usage.memoryBytes : undefined,
    anyway,
    updating,
    updateResult,
  };
}

function idle(): boolean {
  const state = supervisor?.state() ?? "stopped";
  return !updating && (state === "stopped" || state === "crashed");
}

/** Stop or restart: clean unless `anyway`; when the clean stop can't save, the window offers the same without saving. */
async function stopOrRestart(action: "stop" | "restart", arg: unknown): Promise<void> {
  if (!supervisor || updating) return;
  if (action === "restart" && leftover() !== undefined) return pushStatus();
  anyway = undefined;
  const opts = { anyway: anywayRequested(arg) };
  const outcome = action === "stop" ? await supervisor.stop(opts) : await supervisor.restart(opts);
  anyway = outcome === "stopped" ? undefined : action;
  pushStatus();
}

function sendUpdateLine(line: string): void {
  if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.updateLine, line);
}

/** Stops the server (cleanly unless `anyway`; the window has confirmed), runs SteamCMD, and reports how it went. */
async function update(arg: unknown): Promise<void> {
  const steamcmdDir = settings?.steamcmdDir;
  if (updating || !settings || steamcmdDir === undefined || !hasSteamcmdExe(steamcmdDir)) return;
  const state = supervisor?.state() ?? "stopped";
  if (state === "starting" || state === "stopping" || leftover() !== undefined) return;
  const serverDir = settings.serverDir;
  updating = true;
  updateResult = undefined;
  anyway = undefined;
  pushStatus();
  try {
    if (supervisor && state === "running") {
      const outcome = await supervisor.stop({ anyway: anywayRequested(arg) });
      if (outcome !== "stopped") {
        anyway = "update";
        return;
      }
    }
    updateResult = await runUpdate({
      steamcmdDir,
      serverDir,
      spawn: serverSpawn({ env: process.env, execPath: process.execPath, output: true }),
      onLine: sendUpdateLine,
    });
  } finally {
    updating = false;
    pushStatus();
  }
}

function pushStatus(): void {
  if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.status, status());
}

async function refreshUsage(): Promise<void> {
  const pid = currentPid;
  if (supervisor?.state() !== "running" || pid === undefined) return;
  const sample = await sampleProcess(pid);
  if (!sample || supervisor?.state() !== "running" || currentPid !== pid) return;
  const at = Date.now();
  const cpu =
    lastSample?.pid === pid ? cpuPercent(lastSample, { cpuSeconds: sample.cpuSeconds, at }, availableParallelism()) : undefined;
  lastSample = { pid, cpuSeconds: sample.cpuSeconds, at };
  usage = { cpuPercent: cpu ?? usage.cpuPercent, memoryBytes: sample.memoryBytes };
}

/** Every IPC call must come from our own page, never from anything else that might end up in a frame. */
function trusted(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url === indexUrl;
}

/** `arg` is whatever the page sent: untrusted, so each handler reads it only through anywayRequested. */
function handle<T>(channel: string, fn: (arg: unknown) => T | Promise<T>): void {
  ipcMain.handle(channel, async (event, arg: unknown) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return fn(arg);
  });
}

async function pickFolder(title: string): Promise<string | undefined> {
  const options = { title, properties: ["openDirectory" as const] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

async function chooseServerDir(): Promise<ChooseResult> {
  if (!idle()) return { ok: false, reason: "busy" };
  const dir = await pickFolder("Choose the dedicated server folder (the one with FactoryServer.exe)");
  if (dir === undefined) return { ok: false, reason: "cancelled" };
  if (!hasServerExe(dir)) return { ok: false, reason: "missing-exe" };
  // The picker is modal but async: re-check that nothing started meanwhile.
  if (!idle()) return { ok: false, reason: "busy" };
  settings = { ...settings, serverDir: dir };
  saveSettings(settings);
  supervisor = makeSupervisor(dir);
  pushStatus();
  return { ok: true };
}

async function chooseSteamcmdDir(): Promise<ChooseResult> {
  if (!settings) return { ok: false, reason: "cancelled" };
  if (updating) return { ok: false, reason: "busy" };
  const dir = await pickFolder("Choose the SteamCMD folder (the one with steamcmd.exe)");
  if (dir === undefined) return { ok: false, reason: "cancelled" };
  if (!hasSteamcmdExe(dir)) return { ok: false, reason: "missing-exe" };
  if (updating) return { ok: false, reason: "busy" };
  settings = { ...settings, steamcmdDir: dir };
  saveSettings(settings);
  pushStatus();
  return { ok: true };
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 760,
    height: 600,
    minWidth: 480,
    minHeight: 420,
    title: "Satisfactory server manager",
    backgroundColor: "#17191c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("closed", () => {
    win = undefined;
  });
  void win.loadFile(indexFile).then(() => {
    // The e2e no-listening-socket test waits for this line.
    console.log("server-manager: ready");
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  settings = loadSettings();
  if (settings && hasServerExe(settings.serverDir)) supervisor = makeSupervisor(settings.serverDir);

  handle(CHANNELS.getStatus, status);
  handle(CHANNELS.start, () => {
    if (!updating && leftover() === undefined) supervisor?.start();
    else pushStatus();
  });
  handle(CHANNELS.stop, (arg) => stopOrRestart("stop", arg));
  handle(CHANNELS.restart, (arg) => stopOrRestart("restart", arg));
  handle(CHANNELS.update, update);
  handle(CHANNELS.chooseServerDir, chooseServerDir);
  handle(CHANNELS.chooseSteamcmdDir, chooseSteamcmdDir);

  setInterval(() => {
    void refreshUsage().finally(pushStatus);
  }, STATUS_INTERVAL_MS);

  createWindow();
});

app.on("window-all-closed", () => {
  // Quitting leaves the server running (ADR-0040 decision 4); "Stop server and quit" comes with the tray.
  app.quit();
});
