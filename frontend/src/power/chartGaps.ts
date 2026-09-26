/**
 * Where to draw a shaded band for the pixel span [x0, x1] inside the plot [lo, hi]: null when it
 * lies wholly outside, else at least `min` wide, kept inside the plot. Without the minimum, a
 * stretch starting at the last data point (the newest bucket tripped) or one far shorter than a
 * pixel (5 minutes in a year) would draw nothing.
 */
export function bandSpan(x0: number, x1: number, lo: number, hi: number, min: number): { left: number; width: number } | null {
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return null;
  const from = Math.min(x0, x1);
  const to = Math.max(x0, x1);
  if (to < lo || from > hi) return null;
  let left = Math.max(lo, from);
  let right = Math.min(hi, to);
  if (right - left < min) {
    const mid = (left + right) / 2;
    left = Math.max(lo, Math.min(mid - min / 2, hi - min));
    right = Math.min(hi, left + min);
  }
  return { left, width: right - left };
}

/**
 * The indices of values with no value on either side. A line needs two points, so without a dot
 * these readings (one bucket between two gaps) wouldn't show at all. Null means none, which
 * tells uPlot to draw no dots.
 */
export function isolatedIndices(values: ArrayLike<number | null | undefined>): number[] | null {
  const idxs: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null && values[i - 1] == null && values[i + 1] == null) idxs.push(i);
  }
  return idxs.length > 0 ? idxs : null;
}
