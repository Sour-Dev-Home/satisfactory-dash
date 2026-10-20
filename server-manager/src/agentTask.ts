/**
 * The agent's Scheduled Task (ADR-0040: the agent stays a Scheduled Task; the server manager only shows and drives it).
 * Read and controlled through PowerShell's ScheduledTasks cmdlets with fixed scripts: the task name is a constant in the
 * script, nothing from the window or a setting is ever put into it, and the task's definition is never changed (no
 * Register, Unregister, Enable or Disable).
 */

/** The programs a RunFn can run. A closed set: `createRun` (agentProcess.ts) maps each to one fixed file. */
export type Program = "powershell" | "agent";

export interface RunResult {
  /** The exit code; null when the process was ended (timeout) or died by a signal. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunFn = (program: Program, args: readonly string[]) => Promise<RunResult>;

export type AgentTaskState = "running" | "ready" | "disabled" | "missing";

/** The task the runbook (`runbooks/agent-app.md`, "Keeping it running") registers. */
export const AGENT_TASK_NAME = "Satisfactory Dash Agent";

const TASK = `-TaskName '${AGENT_TASK_NAME}'`;

/** Prints the task's State, or `Missing` when there is no such task; any other failure exits 1. */
const GET_SCRIPT =
  `try { $t = Get-ScheduledTask ${TASK} -ErrorAction Stop; [Console]::Out.Write([string]$t.State) } ` +
  `catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { [Console]::Out.Write('Missing') } else { exit 1 } }`;
const START_SCRIPT = `Start-ScheduledTask ${TASK} -ErrorAction Stop`;
const STOP_SCRIPT = `Stop-ScheduledTask ${TASK} -ErrorAction Stop`;

const psArgs = (script: string): string[] => ["-NoProfile", "-NonInteractive", "-Command", script];

/** Task Scheduler's states: Queued is an instance about to run, so it counts as running; Unknown is not a state to show. */
const STATES = new Map<string, AgentTaskState>([
  ["Running", "running"],
  ["Queued", "running"],
  ["Ready", "ready"],
  ["Disabled", "disabled"],
  ["Missing", "missing"],
]);

export async function readAgentTask(run: RunFn): Promise<AgentTaskState> {
  const result = await run("powershell", psArgs(GET_SCRIPT));
  if (result.code !== 0) throw new Error(`Get-ScheduledTask failed (exit ${result.code ?? "none"})`);
  const state = STATES.get(result.stdout.trim());
  if (state === undefined) throw new Error("Get-ScheduledTask gave a state this app doesn't know");
  return state;
}

async function control(run: RunFn, script: string, cmdlet: string): Promise<void> {
  const result = await run("powershell", psArgs(script));
  if (result.code !== 0) throw new Error(`${cmdlet} failed (exit ${result.code ?? "none"})`);
}

export function startAgentTask(run: RunFn): Promise<void> {
  return control(run, START_SCRIPT, "Start-ScheduledTask");
}

export function stopAgentTask(run: RunFn): Promise<void> {
  return control(run, STOP_SCRIPT, "Stop-ScheduledTask");
}
