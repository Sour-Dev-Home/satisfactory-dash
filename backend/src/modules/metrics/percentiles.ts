import { BUCKET_BOUNDS_MS } from "../../platform/metrics/histogramBuckets.js";

/** ADR-0056 section 2: a percentile is a bucket UPPER BOUND ("p95 <= 200 ms"), never interpolated. `null` = above 5 s. */
export type BucketPercentile = number | null;

/** Sum of an element-wise bucket array (the histogram's observation count). */
export function bucketTotal(buckets: readonly number[]): number {
  let total = 0;
  for (const n of buckets) total += n;
  return total;
}

/**
 * The upper bound of the first bucket whose cumulative count reaches `q` of the total (nearest-rank, so p50 of 10
 * observations is the 5th). `null` when it lands in the open-ended last bucket; `undefined` for an empty histogram or an
 * array of the wrong width (nothing to say).
 */
export function percentileUpperBound(buckets: readonly number[], q: number): BucketPercentile | undefined {
  if (buckets.length !== BUCKET_BOUNDS_MS.length) return undefined;
  const total = bucketTotal(buckets);
  if (total <= 0) return undefined;
  const rank = Math.max(1, Math.ceil(q * total));
  let cumulative = 0;
  for (let i = 0; i < buckets.length; i++) {
    cumulative += buckets[i];
    if (cumulative >= rank) {
      const bound = BUCKET_BOUNDS_MS[i];
      return Number.isFinite(bound) ? bound : null;
    }
  }
  return null;
}

export interface Percentiles {
  p50Ms: BucketPercentile;
  p95Ms: BucketPercentile;
  p99Ms: BucketPercentile;
}

/** p50/p95/p99 of the summed buckets, or `undefined` when there are no observations. */
export function summarizeBuckets(buckets: readonly number[]): Percentiles | undefined {
  const p50 = percentileUpperBound(buckets, 0.5);
  const p95 = percentileUpperBound(buckets, 0.95);
  const p99 = percentileUpperBound(buckets, 0.99);
  if (p50 === undefined || p95 === undefined || p99 === undefined) return undefined;
  return { p50Ms: p50, p95Ms: p95, p99Ms: p99 };
}

/** Orders percentiles for "worst first": `null` (above everything) is the largest. */
export function rankOf(value: BucketPercentile): number {
  return value === null ? Number.POSITIVE_INFINITY : value;
}
