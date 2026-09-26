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
