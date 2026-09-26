/**
 * Command de-duplication (ADR-0031 PR 6, architect rule): the backend may hand the same command out again (a long-poll
 * that timed out after the claim, a result that never arrived), so the agent remembers every command id until the
 * command's own `expiresAt` and never runs one twice. If a duplicate arrives after the agent already finished it, the
 * agent re-reports the SAME result instead of running it again. Bounded, so a flood cannot grow it without limit.
 */
export interface CommandResult {
  ok: boolean;
  code?: string;
}

export type LedgerVerdict =
  | { kind: "new" }
  /** Being run right now: do nothing, the running one will report. */
  | { kind: "running" }
  /** Finished before: re-report this result, do not run it. */
  | { kind: "done"; result: CommandResult };

interface Entry {
  expiresAtMs: number;
  result?: CommandResult;
}

export const LEDGER_MAX_ENTRIES = 1_000;

export class CommandLedger {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries: number = LEDGER_MAX_ENTRIES,
  ) {}

  /** Looks the id up (dropping expired entries first) and, when it is new, remembers it as running. */
  begin(id: string, expiresAtMs: number): LedgerVerdict {
    this.purge();
    const known = this.entries.get(id);
    if (known !== undefined) return known.result === undefined ? { kind: "running" } : { kind: "done", result: known.result };
    this.entries.set(id, { expiresAtMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return { kind: "new" };
  }

  /** Records the outcome of a command that `begin` accepted. */
  finish(id: string, result: CommandResult): void {
    const entry = this.entries.get(id);
    if (entry !== undefined) entry.result = result;
  }

  private purge(): void {
    const at = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAtMs <= at) this.entries.delete(id);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
