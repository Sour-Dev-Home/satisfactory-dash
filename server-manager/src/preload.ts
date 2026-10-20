/** The window's only way out: exactly the ServerManagerBridge, as `window.serverManager` (sandboxed preload). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CHANNELS, type ChooseResult, type ServerManagerBridge, type Status } from "./ipc";

const bridge: ServerManagerBridge = {
  getStatus: () => ipcRenderer.invoke(CHANNELS.getStatus) as Promise<Status>,
  onStatus(cb) {
    const listener = (_event: IpcRendererEvent, status: Status) => cb(status);
    ipcRenderer.on(CHANNELS.status, listener);
    return () => {
      ipcRenderer.removeListener(CHANNELS.status, listener);
    };
  },
  start: () => ipcRenderer.invoke(CHANNELS.start) as Promise<void>,
  stop: () => ipcRenderer.invoke(CHANNELS.stop) as Promise<void>,
  restart: () => ipcRenderer.invoke(CHANNELS.restart) as Promise<void>,
  chooseServerDir: () => ipcRenderer.invoke(CHANNELS.chooseServerDir) as Promise<ChooseResult>,
  chooseSteamcmdDir: () => ipcRenderer.invoke(CHANNELS.chooseSteamcmdDir) as Promise<ChooseResult>,
};

contextBridge.exposeInMainWorld("serverManager", bridge);
