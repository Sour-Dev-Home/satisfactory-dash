/**
 * The server manager's main process (ADR-0040). It owns the supervisor and the settings and answers the window's
 * few IPC calls. It opens no port and needs no elevation: the window is a local file, and the only process it
 * starts is the configured FactoryServer.exe (plus PowerShell or ps to read that process's CPU and memory).
 */
import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CHANNELS, type ChooseResult, type Status } from "./ipc";
import { cpuPercent, sampleProcess } from "./processStats";
import { serverSpawn } from "./serverProcess";
import { hasServerExe, hasSteamcmdExe, loadSettings, saveSettings, SERVER_EXE, type Settings } from "./settings";
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

function configured(): boolean {
  return settings !== undefined && hasServerExe(settings.serverDir);
}

function makeSupervisor(serverDir: string): Supervisor {
  const spawn = serverSpawn({ env: process.env, execPath: process.execPath });
  const sup = createSupervisor({
    spawn: (exe, args) => {
      const child = spawn(exe, args);
      currentPid = child.pid;
      child.onSpawn(() => {
        currentPid = child.pid;
      });
      return child;
    },
    now: Date.now,
    serverExe: join(serverDir, SERVER_EXE),
  });
  sup.onChange((state) => {
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

function status(): Status {
  const state = supervisor?.state() ?? "stopped";
  const running = state === "running";
  return {
    state,
    lastError: supervisor?.lastError(),
    configured: configured(),
    serverDir: settings?.serverDir,
    steamcmdDir: settings?.steamcmdDir,
    uptimeMs: running && runningSince !== undefined ? Date.now() - runningSince : undefined,
    cpuPercent: running ? usage.cpuPercent : undefined,
    memoryBytes: running ? usage.memoryBytes : undefined,
  };
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

function handle<T>(channel: string, fn: () => T | Promise<T>): void {
  ipcMain.handle(channel, async (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return fn();
  });
}

async function pickFolder(title: string): Promise<string | undefined> {
  const options = { title, properties: ["openDirectory" as const] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

async function chooseServerDir(): Promise<ChooseResult> {
  const state = supervisor?.state() ?? "stopped";
  if (state !== "stopped" && state !== "crashed") return { ok: false, reason: "busy" };
  const dir = await pickFolder("Choose the dedicated server folder (the one with FactoryServer.exe)");
  if (dir === undefined) return { ok: false, reason: "cancelled" };
  if (!hasServerExe(dir)) return { ok: false, reason: "missing-exe" };
  // The picker is modal but async: re-check that nothing started meanwhile.
  const after = supervisor?.state() ?? "stopped";
  if (after !== "stopped" && after !== "crashed") return { ok: false, reason: "busy" };
  settings = { ...settings, serverDir: dir };
  saveSettings(settings);
  supervisor = makeSupervisor(dir);
  pushStatus();
  return { ok: true };
}

async function chooseSteamcmdDir(): Promise<ChooseResult> {
  if (!settings) return { ok: false, reason: "cancelled" };
  const dir = await pickFolder("Choose the SteamCMD folder (the one with steamcmd.exe)");
  if (dir === undefined) return { ok: false, reason: "cancelled" };
  if (!hasSteamcmdExe(dir)) return { ok: false, reason: "missing-exe" };
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
  handle(CHANNELS.start, () => supervisor?.start());
  handle(CHANNELS.stop, () => supervisor?.stop());
  handle(CHANNELS.restart, () => supervisor?.restart());
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
