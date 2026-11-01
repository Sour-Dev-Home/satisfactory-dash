/**
 * Where arrow keys and Home/End move from stop `i` of `n` in a roving-tabindex list (the item bubbles' buttons, the
 * destination caps' buttons), or null for a key the list leaves alone.
 */
export function nextStop(key: string, i: number, n: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(n - 1, i + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, i - 1);
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}
