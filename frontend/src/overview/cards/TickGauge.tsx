import { SLOW_BELOW, tickTone, toneClass } from "./tick";

export { SLOW_BELOW };

/** The bar's scale: 0 to 30 ticks/s, where 30 is a fresh save's rate (the cards brief). */
export const GAUGE_MAX = 30;

const WIDTH = 120;
const HEIGHT = 8;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The server tick as a compact horizontal bar (#616): filled up to the value in the tick's tone,
 * clamped to 0-30, with a neutral mark where a slow tick turns bad. Static (nothing moves), our own
 * SVG at a fixed width, colours from tokens via currentColor, and hidden from screen readers: the
 * text beside it carries the value.
 */
export function TickGauge({ rate, health = "healthy" }: { rate: number; health?: "healthy" | "slow" }) {
  const clamped = Math.min(Math.max(rate, 0), GAUGE_MAX);
  const tone = tickTone({ rate, health });
  const fill = Number.isFinite(clamped) ? round((clamped / GAUGE_MAX) * WIDTH) : 0;
  const mark = round((SLOW_BELOW / GAUGE_MAX) * WIDTH);
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      data-gauge={clamped}
      data-tone={tone}
      className="h-2 w-24 flex-none"
      fill="none"
    >
      <rect width={WIDTH} height={HEIGHT} rx={HEIGHT / 2} className="text-line" fill="currentColor" />
      {fill > 0 && (
        <rect
          width={fill}
          height={HEIGHT}
          rx={HEIGHT / 2}
          className={`${toneClass(tone)} transition-colors ease-in-out`}
          fill="currentColor"
          data-zone="value"
        />
      )}
      {/* Where a slow tick turns bad: a neutral mark, never a red zone (a healthy bar shows no red). */}
      <line x1={mark} x2={mark} y1={0} y2={HEIGHT} className="text-muted" stroke="currentColor" strokeWidth={1.5} data-zone="slow" />
    </svg>
  );
}
