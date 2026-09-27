/**
 * ADR-0037 §1: fixed millisecond bucket bounds, shared by every histogram metric. Store bucket
 * counts, never percentiles: bucket counts from different hours can be summed to answer a question
 * over any window (1 h, 24 h, 7 d); summed percentiles cannot.
 */
export const BUCKET_BOUNDS_MS: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, Infinity];

/** The index of the first bound the value is at most. Always found: the last bound is +Infinity. */
export function bucketIndex(valueMs: number): number {
  const index = BUCKET_BOUNDS_MS.findIndex((bound) => valueMs <= bound);
  return index === -1 ? BUCKET_BOUNDS_MS.length - 1 : index;
}

/** A fresh all-zero bucket array, the width every stored `bucket_counts` array must match. */
export function emptyBucketCounts(): number[] {
  return Array.from({ length: BUCKET_BOUNDS_MS.length }, () => 0);
}

/** Element-wise sum of two same-length bucket arrays (the in-process mirror of the migration's
 *  `metrics.merge_bucket_counts` SQL function, so a test can check the math without a database). */
export function mergeBucketCounts(a: readonly number[], b: readonly number[]): number[] {
  if (a.length !== b.length) {
    throw new Error(`mergeBucketCounts: length mismatch (${a.length} vs ${b.length})`);
  }
  return a.map((value, i) => value + b[i]);
}
