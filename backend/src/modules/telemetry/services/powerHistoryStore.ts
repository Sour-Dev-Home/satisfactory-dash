import type { PowerHistory, PowerHistoryPoint, PowerHistorySeries } from "@satisfactory-dash/shared";

/** ADR-0022: the live window is 5 minutes, sampled every 5 seconds. */
export const POWER_HISTORY_WINDOW_SECONDS = 300;
export const POWER_HISTORY_INTERVAL_SECONDS = 5;

/** One circuit's readings at one sample time (a `PowerHistoryPoint` without its time). */
export type PowerSampleCircuit = Omit<PowerHistoryPoint, "t"> & { circuitGroupId: number };

/** Everything read from the game server at one tick. `gamePaused` is per sample, not per
 *  circuit: while paused the readings freeze (ADR-0012) and the chart shades the stretch. */
export interface PowerSample {
  /** Unix milliseconds UTC; the tick's nominal time. */
  t: number;
  gamePaused: boolean;
  circuits: PowerSampleCircuit[];
}

/**
 * The source-agnostic store behind the power history route (ADR-0022). Today the poller
 * feeds it; agent ingest (ADR-0020) will feed the same interface later.
 *
 * Guarantees the contract relies on (the schema deliberately does not enforce them, so the
 * producer must): every series is in strictly ascending time order, holds at most
 * windowSeconds / intervalSeconds points, and every paused range has fromT <= toT.
 */
export interface PowerHistoryStore {
  /** Returns false (and stores nothing) for a sample that is not newer than the newest one. */
  append(sample: PowerSample): boolean;
  /** Forgets everything: a new game session, or the game clock went backwards. */
  reset(): void;
  /** The history for the window ending at `nowMs`. */
  window(nowMs: number): PowerHistory;
}

/**
 * A fixed-size ring buffer of samples: memory never grows, and the oldest sample is
 * overwritten once it is full. Capacity is exactly windowSeconds / intervalSeconds, and a
 * read returns only samples newer than `now - window`, so the cap holds even if the
 * sampling cadence is faster than the interval.
 */
export class InMemoryPowerHistoryStore implements PowerHistoryStore {
  private readonly windowSeconds: number;
  private readonly intervalSeconds: number;
  private readonly capacity: number;
  private readonly buffer: (PowerSample | undefined)[];
  private oldest = 0;
  private size = 0;

  constructor(options: { windowSeconds?: number; intervalSeconds?: number } = {}) {
    this.windowSeconds = options.windowSeconds ?? POWER_HISTORY_WINDOW_SECONDS;
    this.intervalSeconds = options.intervalSeconds ?? POWER_HISTORY_INTERVAL_SECONDS;
    if (!Number.isInteger(this.windowSeconds) || this.windowSeconds <= 0) {
      throw new Error("windowSeconds must be a positive integer");
    }
    if (!Number.isInteger(this.intervalSeconds) || this.intervalSeconds <= 0) {
      throw new Error("intervalSeconds must be a positive integer");
    }
    this.capacity = Math.max(1, Math.ceil(this.windowSeconds / this.intervalSeconds));
    this.buffer = Array.from({ length: this.capacity }, (): PowerSample | undefined => undefined);
  }

  append(sample: PowerSample): boolean {
    if (!Number.isSafeInteger(sample.t) || sample.t < 0) {
      return false;
    }
    const newest = this.newest();
    if (newest && sample.t <= newest.t) {
      return false;
    }
    // Copy on the way in, so a caller reusing its arrays can't change what we stored, and
    // keep one reading per circuit (a duplicate id would put two points at one time).
    const byCircuit = new Map<number, PowerSampleCircuit>();
    for (const circuit of sample.circuits) {
      byCircuit.set(circuit.circuitGroupId, { ...circuit });
    }
    const stored: PowerSample = { t: sample.t, gamePaused: sample.gamePaused, circuits: [...byCircuit.values()] };
    if (this.size < this.capacity) {
      this.buffer[(this.oldest + this.size) % this.capacity] = stored;
      this.size++;
    } else {
      this.buffer[this.oldest] = stored;
      this.oldest = (this.oldest + 1) % this.capacity;
    }
    return true;
  }

  reset(): void {
    this.buffer.fill(undefined);
    this.oldest = 0;
    this.size = 0;
  }

  window(nowMs: number): PowerHistory {
    const cutoff = nowMs - this.windowSeconds * 1000;
    const seriesById = new Map<number, PowerHistoryPoint[]>();
    const pausedRanges: PowerHistory["pausedRanges"] = [];
    let open: { fromT: number; toT: number } | undefined;

    for (let i = 0; i < this.size; i++) {
      const sample = this.buffer[(this.oldest + i) % this.capacity]!;
      if (sample.t <= cutoff) {
        continue;
      }
      for (const { circuitGroupId, ...reading } of sample.circuits) {
        const points = seriesById.get(circuitGroupId) ?? [];
        points.push({ t: sample.t, ...reading });
        seriesById.set(circuitGroupId, points);
      }
      if (sample.gamePaused) {
        open = open ? { fromT: open.fromT, toT: sample.t } : { fromT: sample.t, toT: sample.t };
      } else if (open) {
        pausedRanges.push(open);
        open = undefined;
      }
    }
    if (open) {
      pausedRanges.push(open); // still paused at the newest sample
    }

    const series: PowerHistorySeries[] = [...seriesById.entries()]
      .sort(([a], [b]) => a - b)
      .map(([circuitGroupId, points]) => ({ circuitGroupId, points }));
    return { windowSeconds: this.windowSeconds, intervalSeconds: this.intervalSeconds, series, pausedRanges };
  }

  private newest(): PowerSample | undefined {
    return this.size === 0 ? undefined : this.buffer[(this.oldest + this.size - 1) % this.capacity];
  }
}
