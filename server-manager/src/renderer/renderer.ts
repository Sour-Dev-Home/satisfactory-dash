/** The window: renders the status main pushes and forwards button presses over the bridge. No Node here. */
import type { ServerManagerBridge, Status } from "../ipc";
import { actionsFor, chooseMessage, formatBytes, formatCpu, formatUptime } from "./view";

declare global {
  interface Window {
    serverManager: ServerManagerBridge;
  }
}

const bridge = window.serverManager;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const setup = el("setup");
const server = el("server");
const folders = el("folders");
const buttons = {
  start: el<HTMLButtonElement>("start"),
  stop: el<HTMLButtonElement>("stop"),
  restart: el<HTMLButtonElement>("restart"),
};

let latest: Status | undefined;

function render(status: Status): void {
  latest = status;
  setup.hidden = status.configured;
  server.hidden = !status.configured;
  folders.hidden = !status.configured;

  el("state").textContent = status.state;
  el("state-dot").dataset.state = status.state;
  el("uptime").textContent = formatUptime(status.uptimeMs);
  el("cpu").textContent = formatCpu(status.cpuPercent);
  el("memory").textContent = formatBytes(status.memoryBytes);

  const lastError = el("last-error");
  lastError.textContent = status.lastError ?? "";
  lastError.hidden = status.lastError === undefined;
  lastError.dataset.tone = status.state === "crashed" ? "bad" : "warn";

  // aria-disabled, not disabled, so a focused button keeps focus when it stops applying.
  const actions = actionsFor(status.state, status.configured);
  for (const [name, button] of Object.entries(buttons) as [keyof typeof buttons, HTMLButtonElement][]) {
    button.setAttribute("aria-disabled", String(!actions[name]));
  }

  el("server-dir").textContent = status.serverDir ?? "";
  el("steamcmd-dir").textContent = status.steamcmdDir ?? "not set";
  el("change-server").setAttribute("aria-disabled", String(!actionsFor(status.state, true).start));
}

function act(name: keyof typeof buttons, run: () => Promise<void>): void {
  buttons[name].addEventListener("click", () => {
    if (buttons[name].getAttribute("aria-disabled") === "true") return;
    void run().catch(() => undefined);
  });
}

act("start", bridge.start);
act("stop", bridge.stop);
act("restart", bridge.restart);

async function choose(which: "server" | "steamcmd", target: HTMLElement): Promise<void> {
  const result = which === "server" ? await bridge.chooseServerDir() : await bridge.chooseSteamcmdDir();
  target.textContent = chooseMessage(result, which);
}

el("choose-server").addEventListener("click", () => void choose("server", el("setup-error")));
el("change-server").addEventListener("click", (event) => {
  if ((event.currentTarget as HTMLElement).getAttribute("aria-disabled") === "true") return;
  void choose("server", el("folders-error"));
});
el("choose-steamcmd").addEventListener("click", () => void choose("steamcmd", el("folders-error")));

bridge.onStatus(render);
void bridge.getStatus().then((status) => {
  if (!latest) render(status);
});
