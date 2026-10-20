/** The window's only way out: exactly the ServerManagerBridge, as `window.serverManager` (sandboxed preload). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  agentCommandRequested,
  CHANNELS,
  type ActionOptions,
  type AgentCommandResult,
  type AgentStatus,
  type ChooseResult,
  type ServerManagerBridge,
  type Status,
} from "./ipc";

/** Passes on only the one flag main reads, never whatever object the page handed in. */
const action = (opts?: ActionOptions) => (opts?.anyway === true ? { anyway: true } : undefined);

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: ServerManagerBridge = {
  getStatus: () => ipcRenderer.invoke(CHANNELS.getStatus) as Promise<Status>,
  onStatus: (cb) => subscribe<Status>(CHANNELS.status, cb),
  start: () => ipcRenderer.invoke(CHANNELS.start) as Promise<void>,
  stop: (opts) => ipcRenderer.invoke(CHANNELS.stop, action(opts)) as Promise<void>,
  restart: (opts) => ipcRenderer.invoke(CHANNELS.restart, action(opts)) as Promise<void>,
  update: (opts) => ipcRenderer.invoke(CHANNELS.update, action(opts)) as Promise<void>,
  onUpdateLine: (cb) => subscribe<string>(CHANNELS.updateLine, cb),
  chooseServerDir: () => ipcRenderer.invoke(CHANNELS.chooseServerDir) as Promise<ChooseResult>,
  chooseSteamcmdDir: () => ipcRenderer.invoke(CHANNELS.chooseSteamcmdDir) as Promise<ChooseResult>,
  getAgentStatus: () => ipcRenderer.invoke(CHANNELS.getAgentStatus) as Promise<AgentStatus>,
  onAgentStatus: (cb) => subscribe<AgentStatus>(CHANNELS.agentStatus, cb),
  startAgent: () => ipcRenderer.invoke(CHANNELS.startAgent) as Promise<void>,
  stopAgent: () => ipcRenderer.invoke(CHANNELS.stopAgent) as Promise<void>,
  runAgentCommand: (command) =>
    ipcRenderer.invoke(CHANNELS.runAgentCommand, agentCommandRequested(command)) as Promise<AgentCommandResult>,
  openAgentRunbook: () => ipcRenderer.invoke(CHANNELS.openAgentRunbook) as Promise<void>,
  setStartWithWindows: (on) => ipcRenderer.invoke(CHANNELS.setStartWithWindows, on === true) as Promise<void>,
};

contextBridge.exposeInMainWorld("serverManager", bridge);
