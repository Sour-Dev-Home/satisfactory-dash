import { validateRecording } from "./registry.js";
import { bucketIndex, emptyBucketCounts } from "./histogramBuckets.js";

/** One (hour, metric, label set) accumulation. `bucketCounts` is undefined for a counter. */
export interface SeriesDelta {
  hourStartMs: number;
  metric: string;
  labels: Readonly<Record<string, string>>;
  count: number;
  sum: number;
  bucketCounts?: number[];
}

const HOUR_MS = 3_600_000;
const hourStart = (nowMs: number): number => Math.floor(nowMs / HOUR_MS) * HOUR_MS;

/** A stable key so two recordings with the same label set (given in any order) accumulate into the
 *  same delta. JSON.stringify on an object built with keys already in the registry's fixed order
 *  (see `keyFor`) is deterministic without needing to sort here. */
function keyFor(hourStartMs: number, metric: string, labels: Readonly<Record<string, string>>): string {
  const sortedKeys = Object.keys(labels).sort();
  const canonical: Record<string, string> = {};
  for (const key of sortedKeys) canonical[key] = labels[key];
  return `${hourStartMs}\u0000${metric}\u0000${JSON.stringify(canonical)}`;
}

export interface MetricsAggregator {
  recordHistogram(metric: string, labels: Readonly<Record<string, string>>, valueMs: number): void;
  recordCounter(metric: string, labels: Readonly<Record<string, string>>, amount?: number): void;
  /** Everything accumulated since the last `drain()`, and clears it. Calling `drain()` again with
   *  no recordings in between returns an empty array: this is what makes a flush idempotent — a
   *  spurious extra flush (no new samples since the last one) writes nothing, so the stored total
   *  is the same whether the flush ran once or twice back to back. */
  drain(): SeriesDelta[];
}

/**
 * ADR-0037 §2: the in-process side of the metrics table. Every `record*` call is validated against
 * the fixed registry first (`registry.ts`), so a bug that tries to record an unlisted metric or an
 * out-of-set label throws here, before anything reaches Postgres. `now` is injectable for tests.
 */
export function createMetricsAggregator(now: () => number = Date.now): MetricsAggregator {
  let current = new Map<string, SeriesDelta>();

  function delta(metric: string, labels: Readonly<Record<string, string>>, seedBuckets: boolean): SeriesDelta {
    const hourStartMs = hourStart(now());
    const key = keyFor(hourStartMs, metric, labels);
    let entry = current.get(key);
    if (entry === undefined) {
      entry = { hourStartMs, metric, labels, count: 0, sum: 0, bucketCounts: seedBuckets ? emptyBucketCounts() : undefined };
      current.set(key, entry);
    }
    return entry;
  }

  return {
    recordHistogram(metric, labels, valueMs) {
      validateRecording(metric, "histogram", labels);
      const entry = delta(metric, labels, true);
      entry.count += 1;
      entry.sum += valueMs;
      // bucketCounts is always defined here: `delta` seeds it (seedBuckets=true) for every entry
      // this call creates or reuses.
      entry.bucketCounts![bucketIndex(valueMs)] += 1;
    },
    recordCounter(metric, labels, amount = 1) {
      validateRecording(metric, "counter", labels);
      const entry = delta(metric, labels, false);
      entry.count += 1;
      entry.sum += amount;
    },
    drain() {
      const snapshot = current;
      current = new Map();
      return [...snapshot.values()];
    },
  };
}
