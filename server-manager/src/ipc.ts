/**
 * The narrow bridge between the window and the main process: the preload exposes exactly `ServerManagerBridge` as
 * `window.serverManager`, and main answers only these channels. Nothing else crosses (no ipcRenderer, no Node).
 * The game's API token never does either: no channel returns it and no Status field holds it (`preload.test.ts`).
 */
import type { AgentHalted } from "./agentHalted";
import type { AgentTaskState } from "./agentTask";
import type { ServerState } from "./supervisor";

export const CHANNELS = {
  getStatus: "sm:get-status",
  status: "sm:status",
  start: "sm:start",
  stop: "sm:stop",
  restart: "sm:restart",
  update: "sm:update",
  updateLine: "sm:update-line",
  chooseServerDir: "sm:choose-server-dir",
  chooseSteamcmdDir: "sm:choose-steamcmd-dir",
  getAgentStatus: "sm:get-agent-status",
  agentStatus: "sm:agent-status",
  startAgent: "sm:start-agent",
  stopAgent: "sm:stop-agent",
  runAgentCommand: "sm:run-agent-command",
  openAgentRunbook: "sm:open-agent-runbook",
  setStartWithWindows: "sm:set-start-with-windows",
} as const;

/**
 * The agent commands the window may run. `set-tokens` and `enroll` are not here and never will be: they prompt for
 * secrets, so they stay in a console (runbooks/agent-app.md).
 */
export const AGENT_COMMANDS = ["check", "status", "resume"] as const;
export type AgentCommand = (typeof AGENT_COMMANDS)[number];

/** The renderer is untrusted: only one of the literal AGENT_COMMANDS names a command. */
export function agentCommandRequested(arg: unknown): AgentCommand | undefined {
  return AGENT_COMMANDS.find((command) => command === arg);
}

export interface AgentStatus {
  /** The Scheduled Task's state; undefined when PowerShell couldn't read it. */
  task: AgentTaskState | undefined;
  /** The newest lines of the agent's current log, as it wrote them. */
  log: string[];
  /** Set while the agent's halted.json says it is stopped for a reason that needs the owner. */
  halted: AgentHalted | undefined;
  /** A Start or Stop of the task, or an agent command, is running; the buttons wait for it. */
  busy: boolean;
}

export interface AgentCommandResult {
  command: AgentCommand;
  /** null when it couldn't run or didn't finish. */
  exitCode: number | null;
  output: string;
}

/** What a clean stop couldn't do and the window now offers to do without saving. */
export type AnywayAction = "stop" | "restart" | "update";

export interface ActionOptions {
  /** End the server without saving first ("Stop anyway"). */
  anyway?: boolean;
}

export interface Status {
  state: ServerState;
  lastError: string | undefined;
  /** A server an earlier session started and left running; Start stays off while it lives. */
  leftoverPid: number | undefined;
  /** False until a folder holding FactoryServer.exe is saved; the window then asks for one. */
  configured: boolean;
  serverDir: string | undefined;
  steamcmdDir: string | undefined;
  /** Since the process last reached `running`; undefined when it isn't running. */
  uptimeMs: number | undefined;
  cpuPercent: number | undefined;
  memoryBytes: number | undefined;
  /** Set when the last clean stop couldn't save; the window offers the action again without saving. */
  anyway: AnywayAction | undefined;
  /** An update (its stop, then SteamCMD) is in progress; Start, Stop and the folders wait for it. */
  updating: boolean;
  /** How the last update ended, until the next one starts. */
  updateResult: { ok: boolean; code: number } | undefined;
  /** The Start with Windows setting (off by default). */
  startWithWindows: boolean;
}

export type ChooseResult = { ok: true } | { ok: false; reason: "cancelled" | "missing-exe" | "busy" };

export interface ServerManagerBridge {
  getStatus(): Promise<Status>;
  onStatus(cb: (status: Status) => void): () => void;
  start(): Promise<void>;
  stop(opts?: ActionOptions): Promise<void>;
  restart(opts?: ActionOptions): Promise<void>;
  /** Stops the server cleanly if it runs (the window confirms first), then runs SteamCMD. */
  update(opts?: ActionOptions): Promise<void>;
  /** SteamCMD's output, a line at a time, while an update runs. */
  onUpdateLine(cb: (line: string) => void): () => void;
  chooseServerDir(): Promise<ChooseResult>;
  chooseSteamcmdDir(): Promise<ChooseResult>;
  getAgentStatus(): Promise<AgentStatus>;
  onAgentStatus(cb: (status: AgentStatus) => void): () => void;
  /** Start-ScheduledTask / Stop-ScheduledTask for the agent's task. */
  startAgent(): Promise<void>;
  stopAgent(): Promise<void>;
  runAgentCommand(command: AgentCommand): Promise<AgentCommandResult>;
  /** Opens the runbook's "Keeping it running" in the browser; main holds the one address, the window sends none. */
  openAgentRunbook(): Promise<void>;
  /** Adds or removes the per-user login item. */
  setStartWithWindows(on: boolean): Promise<void>;
}

/** The renderer is untrusted: only a literal `{ anyway: true }` asks for an unclean stop. */
export function anywayRequested(arg: unknown): boolean {
  return typeof arg === "object" && arg !== null && (arg as { anyway?: unknown }).anyway === true;
}
