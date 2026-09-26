import type { Logger } from "pino";
import type { FactoryBuilding } from "../../gameserver/index.js";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import type { ItemSampleRow, TransitionRow } from "../repositories/historyRepository.js";
import { classifyBuilding } from "./classifyBuilding.js";
import type { HistoryRecorder } from "./historyRecorder.js";
import type { BackgroundWorker } from "./powerHistoryPoller.js";
import { isBackedUp } from "./productionService.js";

export interface FactoryHistoryPorts {
  getFactoryBuildings(): Promise<FactoryBuilding[]>;
}

export interface FactoryHistoryPollerOptions {
  logger: Logger;
  history: HistoryRecorder;
  intervalSeconds?: number;
  /** A poll that takes longer than this is abandoned and counted as failed. */
  pollTimeoutMs?: number;
  now?: () => number;
}

export const FACTORY_HISTORY_INTERVAL_SECONDS = 30;
const DEFAULT_POLL_TIMEOUT_MS = 30_000;
/** A poll that turns up more transitions than this drops the rest: a mass change (a reload, a tripped grid) is noise. */
export const MAX_TRANSITIONS_PER_POLL = 500;
/** When more than this share of the buildings are new, the world changed (a load, a different save): re-baseline. */
const NEW_IDS_BASELINE_SHARE = 0.5;

/** Total production per item across every building: the factory's output as one sample per item. */
export function sumItemRates(buildings: FactoryBuilding[], atMs: number): ItemSampleRow[] {
  const totals = new Map<string, { current: number; max: number }>();
  for (const building of buildings) {
    for (const rate of building.production) {
      const total = totals.get(rate.className) ?? { current: 0, max: 0 };
      total.current += rate.currentPerMinute;
      total.max += rate.maxPerMinute;
      totals.set(rate.className, total);
    }
  }
  return [...totals].map(([item, total]) => ({ item, atMs, currentPerMinute: total.current, maxPerMinute: total.max }));
}

/**
 * Compares this snapshot's machine states with the last and returns the transitions, updating `known` in place.
 * A building whose state cannot be decided keeps its last state (no transition, no guess). The first snapshot, and
 * one where most buildings are new, only set the baseline.
 */
export function diffStates(
  known: Map<string, string>,
  buildings: FactoryBuilding[],
  atMs: number,
  cap = MAX_TRANSITIONS_PER_POLL,
): TransitionRow[] {
  const current = new Map<string, { state: string; className: string }>();
  for (const building of buildings) {
    const state = classifyBuilding(building, isBackedUp(building))?.state;
    if (state !== undefined) {
      current.set(building.id, { state, className: building.className });
    }
  }
  let newIds = 0;
  for (const id of current.keys()) {
    if (!known.has(id)) newIds++;
  }
  const rebaseline = known.size === 0 || (current.size > 0 && newIds / current.size > NEW_IDS_BASELINE_SHARE);
  const transitions: TransitionRow[] = [];
  if (!rebaseline) {
    for (const [id, { state, className }] of current) {
      const previous = known.get(id);
      if (previous !== state && transitions.length < cap) {
        transitions.push({ atMs, buildingId: id, className, fromState: previous ?? null, toState: state });
      }
    }
  }
  // Forget buildings that are gone, but keep the last state of ones that are present with an undecidable state.
  const present = new Set(buildings.map((building) => building.id));
  for (const id of known.keys()) {
    if (!present.has(id)) known.delete(id);
  }
  if (rebaseline) known.clear();
  for (const [id, { state }] of current) {
    known.set(id, state);
  }
  return transitions;
}

/**
 * ADR-0027: every 30 s, one game server's factory into durable history: item totals and machine-state
 * transitions. Same discipline as the power poller: one poll at a time, a deadline per poll, failures logged on
 * the first of a run, and nothing thrown out of the loop.
 */
export class FactoryHistoryPoller implements BackgroundWorker {
  private readonly intervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly now: () => number;
  private readonly known = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private consecutiveFailures = 0;

  constructor(
    private readonly ports: FactoryHistoryPorts,
    private readonly options: FactoryHistoryPollerOptions,
  ) {
    const seconds = options.intervalSeconds ?? FACTORY_HISTORY_INTERVAL_SECONDS;
    if (!Number.isInteger(seconds) || seconds <= 0) {
      throw new Error("intervalSeconds must be a positive integer");
    }
    this.intervalMs = seconds * 1000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.poll();
    } catch (err) {
      this.options.logger.error({ err: formatErrorDetail(err) }, "factory history poll crashed unexpectedly");
    } finally {
      this.inFlight = undefined;
      this.schedule(this.intervalMs);
    }
  }

  /** One poll; exposed for tests. Never throws for an upstream failure. */
  async poll(): Promise<void> {
    const atMs = this.now();
    let buildings: FactoryBuilding[];
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error(`poll timed out after ${this.pollTimeoutMs} ms`)), this.pollTimeoutMs);
        deadline.unref?.();
      });
      buildings = await Promise.race([this.ports.getFactoryBuildings(), timedOut]);
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures === 1) {
        this.options.logger.warn({ err: formatErrorDetail(err) }, "factory history poll failed; leaving a gap");
      }
      return;
    } finally {
      clearTimeout(deadline);
    }
    if (this.stopped) return;
    if (this.consecutiveFailures > 0) {
      this.options.logger.info({ failedPolls: this.consecutiveFailures }, "factory history polling recovered");
      this.consecutiveFailures = 0;
    }
    this.options.history.recordItems(sumItemRates(buildings, atMs));
    this.options.history.recordTransitions(diffStates(this.known, buildings, atMs));
  }
}
