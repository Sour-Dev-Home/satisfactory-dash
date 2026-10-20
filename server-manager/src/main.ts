/**
 * The server manager's main process (ADR-0040). It owns the supervisor and the settings and answers the window's
 * few IPC calls. It opens no port and needs no elevation: the window is a local file, and the processes it starts are
 * the configured FactoryServer.exe and, for an update, the configured steamcmd.exe (plus PowerShell or ps to read the
 * server's CPU and memory and command line). The clean stop talks to the game's own API with the agent's token, read
 * here and never sent to the window. The Agent panel shows the agent's Scheduled Task, its log's tail and its halted
 * marker, and runs only PowerShell's fixed ScheduledTask scripts and the built agent's check, status and resume
 * (agentProcess.ts).
 *
 * It lives in the tray: closing the window hides it, Quit leaves the server running (detached, so it outlives the app)
 * and the next launch adopts it, and only one instance runs (a second launch shows the first one's window).
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type NativeImage,
} from "electron";
import { resolveDataDir } from "@satisfactory-dash/agent";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readAgentHalted } from "./agentHalted";
import { AGENT_LOG_LINES, tailAgentLog } from "./agentLog";
import { createRun, runAgentCommand } from "./agentProcess";
import { readAgentTask, startAgentTask, stopAgentTask, type AgentTaskState } from "./agentTask";
import { gameApiAccess, openAgentStore } from "./gameAccess";
import {
  anywayRequested,
  CHANNELS,
  type AgentCommandResult,
  type AgentStatus,
  type AnywayAction,
  type ChooseResult,
  type Status,
} from "./ipc";
import { CLOSE_NOTE_BODY, CLOSE_NOTE_TITLE, closeAction, startsHidden, stopServerAndQuit } from "./lifecycle";
import { applyStartWithWindows, loginItemApi, loginItemRegistered, type ApplyResult } from "./loginItem";
import { cpuPercent, processCommandLine, sampleProcess } from "./processStats";
import { createRefresher } from "./refresher";
import {
  clearPid,
  findLeftover,
  isServerCommand,
  leftoverPid,
  processAlive,
  recordPid,
  watchPid,
} from "./leftoverServer";
import { loadPreferences, savePreferences, type Preferences } from "./preferences";
import { RUN_WITH_NODE_ENV, serverSpawn } from "./serverProcess";
import { runUpdate } from "./updater";
import {
  DATA_DIR_ENV,
  hasServerExe,
  hasSteamcmdExe,
  loadSettings,
  saveSettings,
  SERVER_EXE,
  settingsDir,
  type Settings,
} from "./settings";
import { createSupervisor, type Supervisor } from "./supervisor";
import {
  TRAY_ICON_SIZES,
  trayColour,
  trayIconBitmap,
  trayMenu,
  trayTooltip,
  type TrayColour,
  type TrayItem,
  type TrayItemId,
} from "./tray";

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
let prefs: Preferences = loadPreferences(settingsDir());
let quitting = false;
let tray: Tray | undefined;
let trayContextMenu: Menu | undefined;
let trayKey = "";
let closeNotes = 0;

// The e2e switch exists only for a run from the checkout; a packaged build never honours it (nor passes it on to the
// server, SteamCMD or agent processes, which read the same environment).
if (app.isPackaged) delete process.env[RUN_WITH_NODE_ENV];
const testMode = process.env[RUN_WITH_NODE_ENV] === "1";
const loginItems = loginItemApi(process.env, app, settingsDir(), { packaged: app.isPackaged });
const launchSelf = () => ({ execPath: process.execPath, appPath: app.isPackaged ? undefined : app.getAppPath() });
/** Under the e2e switch the fake server runs through this Electron, so adoption accepts it as argv[0]. */
const viaNode = testMode ? process.execPath : undefined;

/** Whether `pid` still runs the configured server (re-checked before an adopted process is ended). */
async function stillServer(pid: number): Promise<boolean> {
  if (!settings) return false;
  const cmd = await processCommandLine(pid);
  return cmd !== undefined && isServerCommand(cmd, join(settings.serverDir, SERVER_EXE), process.platform, viaNode);
}

/** The one address the window can open: the runbook's "Keeping it running", for a missing task. */
const AGENT_RUNBOOK_URL =
  "https://github.com/Sour-Dev-Home/satisfactory-dash/blob/main/docs-vault/wiki/runbooks/agent-app.md#keeping-it-running-a-scheduled-task";
const agentRun = createRun({ env: process.env, execPath: process.execPath, mainDir: __dirname });
let agentTask: AgentTaskState | undefined;
let agentLog: string[] = [];
let agentBusy = false;

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
  const spawn = serverSpawn({ env: process.env, execPath: process.execPath, detached: true });
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
    attach: (pid) => {
      currentPid = pid;
      return watchPid(pid, { isAlive: processAlive, kill: (p) => process.kill(p), stillOurs: stillServer });
    },
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

/**
 * A server an earlier session left running that isn't supervised (yet): while the launch is still checking it, or
 * when its command line couldn't be read. Start stays off meanwhile. Only checked while ours isn't running.
 */
function leftover(): number | undefined {
  const state = supervisor?.state() ?? "stopped";
  if (state !== "stopped" && state !== "crashed") return undefined;
  return leftoverPid(settingsDir(), processAlive);
}

/** At launch: a server the last session left running, still running the configured exe, is supervised again. */
async function adoptLeftover(): Promise<void> {
  if (!settings || !supervisor) return;
  const sup = supervisor;
  const found = await findLeftover(settingsDir(), {
    isAlive: processAlive,
    commandLine: (pid) => processCommandLine(pid),
    serverExe: join(settings.serverDir, SERVER_EXE),
    platform: process.platform,
    viaNode,
  });
  if (found.kind === "ours" && supervisor === sup && idle()) sup.adopt(found.pid);
  pushStatus();
}

function status(): Status {
  const state = supervisor?.state() ?? "stopped";
  const running = state === "running";
  const leftoverServer = leftover();
  return {
    state,
    lastError:
      leftoverServer !== undefined
        ? `A server this app started earlier is still running (process ${leftoverServer}), and the app couldn't confirm it's this server, so it won't take it over. End it in Task Manager (or wait for it to stop), and Start comes back.`
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
    startWithWindows: prefs.startWithWindows,
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
  const current = status();
  if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.status, current);
  updateTray(current);
}

function trayImage(colour: TrayColour): NativeImage {
  const image = nativeImage.createEmpty();
  for (const size of TRAY_ICON_SIZES) {
    const scaleFactor = size / TRAY_ICON_SIZES[0]!;
    const rep = nativeImage.createFromBitmap(trayIconBitmap(colour, size), { width: size, height: size, scaleFactor });
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: rep.toPNG() });
  }
  return image;
}

let trayItems: TrayItem[] = [];
let trayState = { colour: "red" as TrayColour, tooltip: "" };

/** Rebuilds the tray's icon, tooltip and menu, only when one of them changed (status is pushed every few seconds). */
function updateTray(s: Status): void {
  if (!tray || tray.isDestroyed()) return;
  const colour = trayColour(s.state);
  const tooltip = trayTooltip(s.state);
  const items = trayMenu({ state: s.state, configured: s.configured, blocked: s.updating || s.leftoverPid !== undefined });
  const key = JSON.stringify([colour, tooltip, items]);
  if (key === trayKey) return;
  trayKey = key;
  trayItems = items;
  trayState = { colour, tooltip };
  tray.setImage(trayImage(colour));
  tray.setToolTip(tooltip);
  trayContextMenu = Menu.buildFromTemplate(
    items.map((item) =>
      "id" in item
        ? { id: item.id, label: item.label, enabled: item.enabled, click: () => void onTrayItem(item.id) }
        : { type: "separator" as const },
    ),
  );
  tray.setContextMenu(trayContextMenu);
}

function startServer(): void {
  if (!updating && leftover() === undefined) supervisor?.start();
  else pushStatus();
}

/** Stop and Restart from the tray work as the buttons do; when they then offer "Stop anyway", the window shows it. */
async function onTrayItem(id: TrayItemId): Promise<void> {
  switch (id) {
    case "open":
      return showWindow();
    case "start":
      return startServer();
    case "stop":
    case "restart":
      await stopOrRestart(id, undefined);
      if (anyway !== undefined) showWindow();
      return;
    case "quit":
      // The server is left running, detached; the next launch adopts it.
      app.quit();
      return;
    case "stop-and-quit": {
      const sup = supervisor;
      if (!sup || updating || leftover() !== undefined) return showWindow();
      anyway = undefined;
      const outcome = await stopServerAndQuit({ stop: () => sup.stop(), quit: () => app.quit() });
      if (outcome !== "stopped") {
        anyway = "stop";
        pushStatus();
        showWindow();
      }
      return;
    }
  }
}

function createTray(): void {
  tray = new Tray(trayImage("red"));
  tray.setToolTip(trayTooltip("stopped"));
  tray.on("click", () => showWindow());
  tray.on("double-click", () => showWindow());
  pushStatus();
}

/** Said once, the first time closing the window hides it (a balloon from the tray on Windows). */
function showCloseNote(): void {
  closeNotes++;
  prefs = { ...prefs, closeNoteShown: true };
  bestEffort(() => savePreferences(settingsDir(), prefs));
  if (process.platform === "win32" && tray && !tray.isDestroyed()) {
    tray.displayBalloon({ title: CLOSE_NOTE_TITLE, content: CLOSE_NOTE_BODY, iconType: "info" });
  } else if (Notification.isSupported()) {
    new Notification({ title: CLOSE_NOTE_TITLE, body: CLOSE_NOTE_BODY, silent: true }).show();
  }
}

function showWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow(true);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Adds or removes the login item (only ever here, when the owner flips the setting), then remembers the choice. */
function setStartWithWindows(arg: unknown): ApplyResult {
  const on = arg === true;
  const result = applyStartWithWindows(on, {
    api: loginItems,
    launch: launchSelf(),
    save: (value) => savePreferences(settingsDir(), { ...prefs, startWithWindows: value }),
  });
  if (result.ok) prefs = { ...prefs, startWithWindows: on };
  pushStatus();
  return result;
}

/** At launch: a preference left on whose login item isn't this checkout's (it moved) shows as off. Read-only. */
function reconcileStartWithWindows(): void {
  if (!prefs.startWithWindows || loginItemRegistered(loginItems, launchSelf()) !== false) return;
  prefs = { ...prefs, startWithWindows: false };
  bestEffort(() => savePreferences(settingsDir(), prefs));
}

function agentStatus(): AgentStatus {
  return {
    task: agentTask,
    log: agentLog,
    halted: readAgentHalted(resolveDataDir()),
    busy: agentBusy,
  };
}

function pushAgentStatus(): void {
  if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.agentStatus, agentStatus());
}

/**
 * Reads the task's state and the log's tail, one read at a time (refresher.ts). `refreshAgent(true)` after an action
 * waits for a read that started after it, so the panel never shows the state from before Start, Stop or Resume.
 */
const refreshAgent = createRefresher(async () => {
  const [task, log] = await Promise.all([
    readAgentTask(agentRun).catch(() => undefined),
    tailAgentLog(resolveDataDir(), AGENT_LOG_LINES).catch(() => agentLog),
  ]);
  agentTask = task;
  agentLog = log;
});

/** One agent action at a time (Start, Stop or a command); the panel's buttons wait while it runs. */
async function agentAction<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (agentBusy) return fallback;
  agentBusy = true;
  pushAgentStatus();
  try {
    return await fn();
  } catch {
    return fallback;
  } finally {
    agentBusy = false;
    await refreshAgent(true).catch(() => undefined);
    pushAgentStatus();
  }
}

function agentCommand(arg: unknown): Promise<AgentCommandResult | undefined> {
  return agentAction<AgentCommandResult | undefined>(() => runAgentCommand(agentRun, arg), undefined);
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

function createWindow(show: boolean): void {
  win = new BrowserWindow({
    show,
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
  win.on("close", (event) => {
    const action = closeAction({ quitting, noteShown: prefs.closeNoteShown });
    if (!action.hide) return;
    event.preventDefault();
    win?.hide();
    if (action.note) showCloseNote();
  });
  win.on("closed", () => {
    win = undefined;
  });
  void win.loadFile(indexFile).then(() => {
    // The e2e no-listening-socket test waits for this line.
    console.log("server-manager: ready");
  });
}

/**
 * What the e2e tests read and press in the main process, since the OS tray can't be driven: the tray's state and its
 * real menu items. Only under the e2e switch; nothing in the window can reach it.
 */
function installTestHook(): void {
  (globalThis as Record<string, unknown>).__serverManagerE2E = {
    tray: () => ({ ...trayState, items: trayItems }),
    clickTray: (id: TrayItemId) => trayContextMenu?.getMenuItemById(id)?.click(),
    closeNotes: () => closeNotes,
  };
}

// The e2e tests give each run its own data folder; Electron's own profile (and so the single-instance lock) goes with
// it, so a test never hands off to, or blocks, a server manager the owner has open.
const dataOverride = process.env[DATA_DIR_ENV];
if (dataOverride) app.setPath("userData", join(dataOverride, "electron"));

if (!app.requestSingleInstanceLock()) {
  // Another instance runs: it shows its window (second-instance below), and this one ends.
  app.quit();
} else {
  // A second launch before this one is ready only asks for the window; it is shown once it exists.
  let showWhenReady = false;
  app.on("second-instance", () => {
    if (app.isReady() && win) showWindow();
    else showWhenReady = true;
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  // Closing the window only hides it; the app ends through Quit or "Stop server and quit" in the tray.
  app.on("window-all-closed", () => undefined);

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    settings = loadSettings();
    if (settings && hasServerExe(settings.serverDir)) supervisor = makeSupervisor(settings.serverDir);

    handle(CHANNELS.getStatus, status);
    handle(CHANNELS.start, startServer);
    handle(CHANNELS.stop, (arg) => stopOrRestart("stop", arg));
    handle(CHANNELS.restart, (arg) => stopOrRestart("restart", arg));
    handle(CHANNELS.update, update);
    handle(CHANNELS.chooseServerDir, chooseServerDir);
    handle(CHANNELS.chooseSteamcmdDir, chooseSteamcmdDir);
    handle(CHANNELS.getAgentStatus, agentStatus);
    handle(CHANNELS.startAgent, () => agentAction(() => startAgentTask(agentRun), undefined));
    handle(CHANNELS.stopAgent, () => agentAction(() => stopAgentTask(agentRun), undefined));
    handle(CHANNELS.runAgentCommand, agentCommand);
    handle(CHANNELS.openAgentRunbook, () => shell.openExternal(AGENT_RUNBOOK_URL));
    handle(CHANNELS.setStartWithWindows, setStartWithWindows);

    setInterval(() => {
      void refreshUsage().finally(pushStatus);
      void refreshAgent().finally(pushAgentStatus);
    }, STATUS_INTERVAL_MS);
    void refreshAgent().finally(pushAgentStatus);

    if (testMode) installTestHook();
    reconcileStartWithWindows();
    createTray();
    createWindow(showWhenReady || !startsHidden(process.argv));
    void adoptLeftover();
  });
}
