import { UpstreamError } from "@satisfactory-dash/game-adapter";
import { AGENT_RESULT_CODES, SetAutoPauseParamsSchema } from "@satisfactory-dash/shared";
import type { AgentCommand } from "@satisfactory-dash/shared";
import { backoffDelayMs } from "./backoff.js";
import { BackendError } from "./backendClient.js";
import { CommandLedger } from "./ledger.js";
import type { CommandResult } from "./ledger.js";
import type { AgentLogger } from "./logger.js";
import { abortableSleep } from "./pusher.js";
import type { Sleep } from "./pusher.js";
import type { GameReader } from "./sampler.js";

type ResultCode = (typeof AGENT_RESULT_CODES)[number];

export interface CommandRunnerOptions {
  client: {
    pollCommands(waitSeconds: number, signal?: AbortSignal): Promise<AgentCommand[]>;
    postResult(commandId: string, result: { ok: boolean; code?: ResultCode }): Promise<void>;
  };
  game: Pick<GameReader, "applyAutoPause">;
  logger: AgentLogger;
  ledger?: CommandLedger;
  now?: () => number;
  sleep?: Sleep;
  random?: () => number;
  /** Called once when the backend rejects the credential (401). */
  onAuthRejected: () => void;
}

/** The long-poll spacing floor: a server that answers an empty poll at once must not be polled in a tight loop. */
export const MIN_POLL_SPACING_MS = 1_000;
const RESULT_ATTEMPTS = 5;

/** What the game's failure means to the dashboard: a code from the contract's fixed list, never text. */
export function resultCodeFor(err: unknown): ResultCode {
  if (err instanceof UpstreamError) {
    if (err.failureKind === "unreachable") return "upstream_unreachable";
    if (err.status === 401 || err.status === 403) return "upstream_auth_rejected";
  }
  return "upstream_error";
}

/**
 * Runs the commands the backend hands out by long-poll (ADR-0031 PR 6). Rules (architect):
 *  - IDEMPOTENT and DE-DUPLICATED: every command id is remembered until its own `expiresAt` (CommandLedger). A command that
 *    arrives again is never run twice: while it runs it is skipped; once done its SAME result is re-reported. A command whose
 *    `expiresAt` has passed is never run.
 *  - Only known types run (`set_auto_pause`); an unknown type, or params that do not parse, is reported `unsupported`.
 *  - The result is a CODE from the contract's fixed list, never free text (a game server's message could hold a token).
 *  - A failed poll backs off with jitter and retries; a 401 stops the runner and tells the caller (re-enrol).
 */
export class CommandRunner {
  private readonly ledger: CommandLedger;
  private readonly now: () => number;
  private poke: (() => void) | undefined;

  constructor(private readonly options: CommandRunnerOptions) {
    this.now = options.now ?? Date.now;
    this.ledger = options.ledger ?? new CommandLedger(this.now);
  }

  /** The snapshot answer said a command is waiting: end the wait before the next poll. */
  notifyPending(): void {
    this.poke?.();
  }

  async run(signal: AbortSignal): Promise<void> {
    const sleep = this.options.sleep ?? abortableSleep;
    let failures = 0;
    while (!signal.aborted) {
      const startedAt = this.now();
      try {
        const commands = await this.options.client.pollCommands(25, signal);
        if (failures > 0) this.options.logger.info("poll_recovered", { attempts: failures });
        failures = 0;
        for (const command of commands) {
          if (signal.aborted) return;
          if (await this.handle(command, signal, sleep)) return; // credential rejected
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof BackendError && err.kind === "auth_rejected") {
          this.options.logger.error("auth_rejected", { status: err.status });
          this.options.onAuthRejected();
          return;
        }
        const code = err instanceof BackendError ? err.code ?? (err.kind === "fatal" ? "refused" : "unreachable_or_5xx") : "internal_error";
        if (failures === 0) this.options.logger.warn("poll_failed", { code, status: err instanceof BackendError ? err.status : undefined });
        const retryAfter = err instanceof BackendError ? err.retryAfterMs ?? 0 : 0;
        await sleep(Math.max(retryAfter, backoffDelayMs(failures, { random: this.options.random })), signal);
        failures += 1;
        continue;
      }
      // A poll that came back at once (an empty answer, or commands to run) is spaced, and a "pending" hint ends the wait early.
      const spent = this.now() - startedAt;
      if (spent < MIN_POLL_SPACING_MS) await this.wait(MIN_POLL_SPACING_MS - spent, signal, sleep);
    }
  }

  private wait(ms: number, signal: AbortSignal, sleep: Sleep): Promise<void> {
    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.poke = undefined;
        resolve();
      };
      this.poke = finish;
      void sleep(ms, signal).then(finish);
    });
  }

  /** Handles one command; returns true when the credential was rejected and the runner must stop. */
  private async handle(command: AgentCommand, signal: AbortSignal, sleep: Sleep): Promise<boolean> {
    const expiresAtMs = Date.parse(command.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= this.now()) {
      this.options.logger.warn("command_expired_skipped", { type: safeType(command.type) });
      return false; // never run an expired command
    }
    const verdict = this.ledger.begin(command.id, expiresAtMs);
    if (verdict.kind === "running") return false;
    let result: CommandResult;
    if (verdict.kind === "done") {
      result = verdict.result; // a duplicate: report what was already decided, do not run it again
      this.options.logger.info("command_duplicate", { type: safeType(command.type) });
    } else {
      result = await this.execute(command);
      this.ledger.finish(command.id, result);
      this.options.logger.info("command_done", { type: safeType(command.type), ok: result.ok, code: result.code });
    }
    return this.report(command, result, expiresAtMs, signal, sleep);
  }

  private async execute(command: AgentCommand): Promise<CommandResult> {
    if (command.type !== "set_auto_pause") return { ok: false, code: "unsupported" };
    const params = SetAutoPauseParamsSchema.safeParse(command.params);
    if (!params.success) return { ok: false, code: "unsupported" };
    try {
      await this.options.game.applyAutoPause(params.data.enabled);
      return { ok: true };
    } catch (err) {
      return { ok: false, code: resultCodeFor(err) };
    }
  }

  /** Reports a result, retrying while the command is still alive. Returns true when the credential was rejected. */
  private async report(command: AgentCommand, result: CommandResult, expiresAtMs: number, signal: AbortSignal, sleep: Sleep): Promise<boolean> {
    const body = result.ok ? { ok: true } : { ok: false, code: result.code as ResultCode };
    for (let attempt = 0; attempt < RESULT_ATTEMPTS && !signal.aborted; attempt++) {
      try {
        await this.options.client.postResult(command.id, body);
        return false;
      } catch (err) {
        if (!(err instanceof BackendError)) return false;
        if (err.kind === "auth_rejected") {
          this.options.logger.error("auth_rejected", { status: err.status });
          this.options.onAuthRejected();
          return true;
        }
        // command_not_found / command_expired (or any other refusal): the backend has closed this command, nothing to retry.
        if (err.kind === "fatal") return false;
        if (this.now() >= expiresAtMs) return false; // expired while trying: the backend will not take it
        await sleep(Math.max(err.retryAfterMs ?? 0, backoffDelayMs(attempt, { random: this.options.random })), signal);
      }
    }
    this.options.logger.warn("result_not_reported", { type: safeType(command.type) });
    return false;
  }
}

/** A command type as a log value: only the known one by name, anything else generically (a type is backend-chosen text). */
const safeType = (type: string): string => (type === "set_auto_pause" ? type : "other");
