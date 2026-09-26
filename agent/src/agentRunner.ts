import type { Cadence, SnapshotRequest } from "@satisfactory-dash/shared";
import { CommandRunner } from "./commandRunner.js";
import type { CommandRunnerOptions } from "./commandRunner.js";
import type { AgentLogger } from "./logger.js";
import { Pusher, abortableSleep } from "./pusher.js";
import type { PusherOptions, Sleep } from "./pusher.js";
import { BoundedQueue } from "./queue.js";
import { Sampler } from "./sampler.js";
import type { GameReader } from "./sampler.js";

/** Until the first answer says otherwise, the cadence the backend starts every agent with (backend/agents/config.ts). */
export const INITIAL_CADENCE: Cadence = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
/** About ten minutes of snapshots at the fastest cadence; past that the oldest are dropped (see BoundedQueue). */
export const QUEUE_MAX_SNAPSHOTS = 120;

export type RunOutcome = "stopped" | "auth_rejected";

export interface RunAgentOptions {
  reader: GameReader;
  client: PusherOptions["client"] & CommandRunnerOptions["client"];
  logger: AgentLogger;
  /** Ends the run (SIGINT/SIGTERM). */
  signal: AbortSignal;
  now?: () => number;
  sleep?: Sleep;
  random?: () => number;
  queueMax?: number;
}

/**
 * The agent's main loop (ADR-0031 PR 6): three cooperating loops that share one stop signal.
 *  - SAMPLE: every `min(cadence)` it reads the game and queues a snapshot; the cadence comes from the backend's answers.
 *  - PUSH: sends the queue oldest first, with backoff and jitter (pusher.ts).
 *  - COMMANDS: the long-poll for what the dashboard asked (commandRunner.ts); a snapshot answer that says "a command is
 *    waiting" ends its idle wait.
 * A 401 anywhere stops all three and the run returns `auth_rejected`: the caller tells the owner to re-enrol, and the agent
 * never retries a credential the backend has rejected.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunOutcome> {
  const { logger } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const stop = new AbortController();
  const stopFromOutside = () => stop.abort();
  if (options.signal.aborted) return "stopped";
  options.signal.addEventListener("abort", stopFromOutside, { once: true });

  let outcome: RunOutcome = "stopped";
  const authRejected = () => {
    outcome = "auth_rejected";
    stop.abort();
  };

  let cadence: Cadence = INITIAL_CADENCE;
  const sampler = new Sampler({ reader: options.reader, cadence: () => cadence, logger });
  const commands = new CommandRunner({ client: options.client, game: options.reader, logger, now, sleep, random: options.random, onAuthRejected: authRejected });
  const pusher = new Pusher({
    client: options.client,
    queue: new BoundedQueue<SnapshotRequest>(options.queueMax ?? QUEUE_MAX_SNAPSHOTS),
    logger,
    onCadence: (next) => {
      cadence = next;
    },
    onCommandsPending: () => commands.notifyPending(),
    onAuthRejected: authRejected,
    sleep,
    random: options.random,
  });

  const sampleLoop = async () => {
    while (!stop.signal.aborted) {
      const startedAt = now();
      try {
        pusher.enqueue(await sampler.sample(startedAt));
      } catch {
        // The sampler reports its own failures; anything that still escapes must not end the agent.
        logger.error("sample_failed", { code: "internal_error" });
      }
      const period = Math.min(cadence.statusSeconds, cadence.powerSeconds, cadence.factorySeconds) * 1000;
      const spent = Math.max(0, now() - startedAt); // a clock set back must not turn into a long sleep
      await sleep(Math.max(250, period - spent), stop.signal);
    }
  };

  logger.info("agent_started", { statusSeconds: cadence.statusSeconds });
  try {
    await Promise.all([sampleLoop(), pusher.run(stop.signal), commands.run(stop.signal)]);
  } finally {
    options.signal.removeEventListener("abort", stopFromOutside);
  }
  logger.info("agent_stopped", { reason: outcome });
  return outcome;
}
