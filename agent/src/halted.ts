import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A marker for "this agent must not keep restarting" (ADR-0031 PR 6, security review). Two conditions are permanent until a
 * person acts: the backend rejected the credential (401) and the store cannot be unprotected. A Scheduled Task that restarts
 * on failure would otherwise spawn the agent, and PowerShell, and call the backend, forever. When `run` meets one, it writes
 * this marker; while it exists `run` says why and ends with SUCCESS (exit 0), which the task's restart-on-failure policy does
 * not retry. `enroll`, `set-tokens`, `forget-credential` and `resume` clear it. The file holds a reason code and a time only.
 */

export type HaltReason = "credential_rejected" | "store_unreadable";

const FILE = "halted.json";
const REASONS: readonly HaltReason[] = ["credential_rejected", "store_unreadable"];

export interface Halted {
  reason: HaltReason;
  at: string;
}

export function writeHalted(dir: string, reason: HaltReason, now: () => number = Date.now): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, FILE), `${JSON.stringify({ reason, at: new Date(now()).toISOString() })}\n`, "utf8");
  } catch {
    // Failing to write the marker only costs the restart protection; the agent still ends with its own exit code.
  }
}

/** The marker, or undefined when there is none or it is not one this agent wrote. */
export function readHalted(dir: string): Halted | undefined {
  const file = path.join(dir, FILE);
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Halted>;
    if (REASONS.includes(parsed.reason as HaltReason) && typeof parsed.at === "string") return { reason: parsed.reason as HaltReason, at: parsed.at.slice(0, 40) };
  } catch {
    // an unreadable marker is treated as absent: better to try again than to stay stopped by a corrupt file
  }
  return undefined;
}

export function clearHalted(dir: string): void {
  try {
    unlinkSync(path.join(dir, FILE));
  } catch {
    // already gone
  }
}
