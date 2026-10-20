/** Pure helpers for the window's Agent panel: which buttons apply, what the notes say, and how a log line is laid out. */
import type { AgentCommandResult, AgentStatus } from "../ipc";
import type { AgentHalted } from "../agentHalted";
import type { AgentTaskState } from "../agentTask";

/** Start and Stop follow the task's state; a missing task offers the runbook's set-up instead of buttons. */
export function agentActions(s: AgentStatus): { start: boolean; stop: boolean; setup: boolean } {
  if (s.busy) return { start: false, stop: false, setup: false };
  return { start: s.task === "ready", stop: s.task === "running", setup: s.task === "missing" };
}

export function agentStateLabel(task: AgentTaskState | undefined): string {
  if (task === undefined) return "unknown";
  if (task === "missing") return "not set up";
  return task;
}

export function agentNote(s: AgentStatus): string {
  if (s.task === undefined) return "Couldn't read the agent's Scheduled Task. This tries again in a few seconds.";
  if (s.task === "missing") return "The agent's Scheduled Task isn't set up on this PC yet.";
  if (s.task === "disabled") return "The agent's Scheduled Task is disabled: enable it in Task Scheduler to start it here.";
  return "";
}

/** The halted marker's reason and the runbook's fix (runbooks/agent-app.md, "Troubleshooting"). */
export function haltedText(halted: AgentHalted): { reason: string; fix: string } {
  if (halted.reason === "credential_rejected") {
    return {
      reason: `The agent is stopped: the backend rejected its credential (${halted.at}).`,
      fix: "Create a new enrolment code in the dashboard, then in a console run `node agent.cjs enroll <CODE> --url <https://backend> --replace`. Enrolling again clears this.",
    };
  }
  return {
    reason: `The agent is stopped: it could not unprotect its store (${halted.at}).`,
    fix: "Run the task as the Windows user that set the agent up, with a logon type that loads that user's profile, then press Resume.",
  };
}

export interface LogLineParts {
  time: string;
  level: string;
  event: string;
  /** The line's other fields, `name=value`, exactly as the agent wrote them. */
  detail: string;
}

/** Lays out one of the agent's JSON lines; a line that isn't one is shown whole, as it is. */
export function logLineParts(line: string): LogLineParts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { time: "", level: "", event: "", detail: line };
  const record = parsed as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
  const detail = Object.entries(record)
    .filter(([key]) => key !== "t" && key !== "level" && key !== "event")
    .map(([key, value]) => `${key}=${text(value)}`)
    .join(" ");
  return { time: text(record.t ?? ""), level: text(record.level ?? ""), event: text(record.event ?? ""), detail };
}

/**
 * How to turn the shown lines into the new ones: drop `drop` from the top, append `add`. The tail slides as the agent
 * writes, so only new lines are added (the log region then announces only those); lines that don't continue the old
 * ones (a new day's file) replace them all.
 */
export function logDelta(prev: readonly string[], next: readonly string[]): { drop: number; add: string[] } {
  for (let drop = 0; drop < prev.length; drop++) {
    const kept = prev.length - drop;
    if (kept > next.length) continue;
    let continues = true;
    for (let i = 0; i < kept; i++) {
      if (prev[drop + i] !== next[i]) {
        continues = false;
        break;
      }
    }
    if (continues) return { drop, add: next.slice(kept) };
  }
  return { drop: prev.length, add: [...next] };
}

export function commandHeading(result: AgentCommandResult): string {
  const name = `agent ${result.command}`;
  if (result.exitCode === null) return `${name}: didn't finish`;
  if (result.exitCode === 0) return `${name}: finished`;
  return `${name}: exited with code ${result.exitCode}`;
}
