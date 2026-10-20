/** The window: renders the status main pushes and forwards button presses over the bridge. No Node here. */
import type { AgentCommand, AgentStatus, ServerManagerBridge, Status } from "../ipc";
import {
  agentActions,
  agentNote,
  agentStateLine,
  atBottom,
  commandHeading,
  haltedText,
  levelTag,
  logDelta,
  logLineParts,
} from "./agentView";
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

// The Agent panel: the agent's Scheduled Task, its log's tail, its halted marker, and its check/status/resume.
const agentButtons = {
  start: el<HTMLButtonElement>("agent-start"),
  stop: el<HTMLButtonElement>("agent-stop"),
  check: el<HTMLButtonElement>("agent-check"),
  status: el<HTMLButtonElement>("agent-status"),
  resume: el<HTMLButtonElement>("agent-resume"),
};
const agentLogList = el("agent-log");
const agentOutput = el("agent-output");
const agentCommandHeading = el("agent-command-heading");
let agentLatest: AgentStatus | undefined;
let shownLog: string[] = [];

function logItem(line: string): HTMLLIElement {
  const parts = logLineParts(line);
  const item = document.createElement("li");
  if (parts.level !== "") item.dataset.level = parts.level;
  for (const [cls, text] of [
    ["log-level", levelTag(parts.level)],
    ["log-time", parts.time],
    ["log-event", parts.event],
    ["log-detail", parts.detail],
  ] as const) {
    if (text === "") continue;
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    item.append(span);
  }
  return item;
}

function renderAgentLog(next: string[]): void {
  const { drop, add } = logDelta(shownLog, next);
  // Follow new lines only when the owner is already at the end, not while they read further up.
  const follow = atBottom(agentLogList);
  for (let i = 0; i < drop; i++) agentLogList.firstElementChild?.remove();
  for (const line of add) agentLogList.append(logItem(line));
  shownLog = [...next];
  if (add.length > 0 && follow) agentLogList.scrollTop = agentLogList.scrollHeight;
  agentLogList.hidden = next.length === 0;
  el("agent-log-empty").hidden = next.length > 0;
}

function renderAgent(s: AgentStatus): void {
  agentLatest = s;
  const line = agentStateLine(s);
  el("agent-state").textContent = line.label;
  el("agent-dot").dataset.state = line.dot;
  el("agent-note").textContent = agentNote(s);
  // While halted, Resume is the one primary action.
  agentButtons.start.classList.toggle("primary", s.halted === undefined);

  const actions = agentActions(s);
  el("agent-task-actions").hidden = s.task === "missing";
  el("agent-setup").hidden = s.task !== "missing";
  el("agent-runbook").setAttribute("aria-disabled", String(!actions.setup));
  agentButtons.start.setAttribute("aria-disabled", String(!actions.start));
  agentButtons.stop.setAttribute("aria-disabled", String(!actions.stop));
  for (const button of [agentButtons.check, agentButtons.status, agentButtons.resume]) {
    button.setAttribute("aria-disabled", String(s.busy));
  }

  const halted = el("agent-halted");
  halted.hidden = s.halted === undefined;
  if (s.halted !== undefined) {
    const text = haltedText(s.halted);
    el("agent-halted-reason").textContent = text.reason;
    el("agent-halted-fix").textContent = text.fix;
  }

  renderAgentLog(s.log);
}

async function runCommand(command: AgentCommand): Promise<void> {
  agentCommandHeading.textContent = `Running agent ${command}…`;
  // The last command's output would read as this one's.
  agentOutput.textContent = "";
  agentOutput.hidden = true;
  const result = await bridge.runAgentCommand(command);
  if (!result) {
    agentCommandHeading.textContent = "";
    return;
  }
  agentCommandHeading.textContent = commandHeading(result);
  agentOutput.textContent = result.output;
  agentOutput.hidden = result.output === "";
}

onPress(agentButtons.start, () => bridge.startAgent());
onPress(agentButtons.stop, () => bridge.stopAgent());
onPress(agentButtons.check, () => runCommand("check"));
onPress(agentButtons.status, () => runCommand("status"));
onPress(agentButtons.resume, () => runCommand("resume"));
onPress(el("agent-runbook"), () => bridge.openAgentRunbook());

bridge.onAgentStatus(renderAgent);
void bridge.getAgentStatus().then((status) => {
  if (!agentLatest) renderAgent(status);
});
