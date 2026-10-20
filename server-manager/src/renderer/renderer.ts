/** The window: renders the status main pushes and forwards button presses over the bridge. No Node here. */
import type { ServerManagerBridge, Status } from "../ipc";
import {
  actionsFor,
  anywayLabel,
  chooseMessage,
  formatBytes,
  formatCpu,
  formatUptime,
  LOG_LINES,
  offerStartAfterUpdate,
  updateAllowed,
  updateNeedsConfirm,
  updateNote,
} from "./view";

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
const updatePanel = el("update");
const buttons = {
  start: el<HTMLButtonElement>("start"),
  stop: el<HTMLButtonElement>("stop"),
  restart: el<HTMLButtonElement>("restart"),
};
const anywayButton = el<HTMLButtonElement>("anyway");
const updateButton = el<HTMLButtonElement>("update-server");
const confirmBox = el("update-confirm");
const log = el("update-log");

let latest: Status | undefined;
let logCount = 0;

function render(status: Status): void {
  latest = status;
  setup.hidden = status.configured;
  server.hidden = !status.configured;
  folders.hidden = !status.configured;
  updatePanel.hidden = !status.configured;

  el("state").textContent = status.state;
  el("state-dot").dataset.state = status.state;
  el("uptime").textContent = formatUptime(status.uptimeMs);
  el("cpu").textContent = formatCpu(status.cpuPercent);
  el("memory").textContent = formatBytes(status.memoryBytes);

  const lastError = el("last-error");
  // Stays in the page (empty hides it through CSS) so the live region announces a message present at launch.
  lastError.textContent = status.lastError ?? "";
  lastError.dataset.tone = status.state === "crashed" && status.leftoverPid === undefined ? "bad" : "warn";

  // aria-disabled, not disabled, so a focused button keeps focus when it stops applying.
  const actions = actionsFor(status.state, status.configured && status.leftoverPid === undefined && !status.updating);
  for (const [name, button] of Object.entries(buttons) as [keyof typeof buttons, HTMLButtonElement][]) {
    button.setAttribute("aria-disabled", String(!actions[name]));
  }
  anywayButton.hidden = status.anyway === undefined;
  if (status.anyway !== undefined) anywayButton.textContent = anywayLabel(status.anyway);

  const canUpdate = updateAllowed(status);
  updateButton.setAttribute("aria-disabled", String(!canUpdate));
  if (!canUpdate || !updateNeedsConfirm(status.state)) confirmBox.hidden = true;
  el("update-note").textContent = updateNote(status);
  el("update-after").hidden = !offerStartAfterUpdate(status);

  el("server-dir").textContent = status.serverDir ?? "";
  el("steamcmd-dir").textContent = status.steamcmdDir ?? "not set";
  const canChangeFolder = actionsFor(status.state, true).start && status.leftoverPid === undefined && !status.updating;
  el("change-server").setAttribute("aria-disabled", String(!canChangeFolder));
  el("choose-steamcmd").setAttribute("aria-disabled", String(status.updating));
}

function onPress(button: HTMLElement, run: () => Promise<void> | void): void {
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    void Promise.resolve(run()).catch(() => undefined);
  });
}

onPress(buttons.start, () => bridge.start());
onPress(buttons.stop, () => bridge.stop());
onPress(buttons.restart, () => bridge.restart());
onPress(anywayButton, () => {
  const action = latest?.anyway;
  anywayButton.hidden = true;
  // The focused button just hid itself: keep focus in the server card.
  (action === "update" ? updateButton : buttons.stop).focus();
  if (action === "update") return startUpdate({ anyway: true });
  if (action === "restart") return bridge.restart({ anyway: true });
  return bridge.stop({ anyway: true });
});

function startUpdate(opts?: { anyway: true }): Promise<void> {
  const hadFocus = confirmBox.contains(document.activeElement);
  confirmBox.hidden = true;
  logCount = 0;
  log.replaceChildren();
  log.hidden = false;
  // "Stop and update" just hid with the confirm box: move focus to the log it now fills.
  if (hadFocus) log.focus();
  return bridge.update(opts);
}

onPress(updateButton, () => {
  if (latest && updateNeedsConfirm(latest.state)) {
    confirmBox.hidden = false;
    el("update-confirm-yes").focus();
    return;
  }
  return startUpdate();
});
onPress(el("update-confirm-yes"), () => startUpdate());
onPress(el("update-confirm-no"), () => {
  confirmBox.hidden = true;
  updateButton.focus();
});
onPress(el("start-after-update"), () => bridge.start());

// One node per line, appended, so the role=log region announces only what's new.
bridge.onUpdateLine((line) => {
  log.append(`${line}\n`);
  logCount++;
  if (logCount > LOG_LINES) {
    log.firstChild?.remove();
    logCount--;
  }
  log.scrollTop = log.scrollHeight;
});

async function choose(which: "server" | "steamcmd", target: HTMLElement): Promise<void> {
  const result = which === "server" ? await bridge.chooseServerDir() : await bridge.chooseSteamcmdDir();
  target.textContent = chooseMessage(result, which);
}

el("choose-server").addEventListener("click", () => void choose("server", el("setup-error")));
onPress(el("change-server"), () => choose("server", el("folders-error")));
onPress(el("choose-steamcmd"), () => choose("steamcmd", el("folders-error")));

bridge.onStatus(render);
void bridge.getStatus().then((status) => {
  if (!latest) render(status);
});
