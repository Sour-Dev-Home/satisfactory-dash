import { SLOW_BELOW, tickTone, toneClass } from "./tick";

export { SLOW_BELOW };

/** The dial's scale: 0 to 30 ticks/s, where 30 is a fresh save's rate (the cards brief). */
export const GAUGE_MAX = 30;

const CX = 60;
const CY = 62;
const R = 50;

/** A point on the dial for a value, 0 at the left end and GAUGE_MAX at the right. */
function point(value: number, radius: number): { x: number; y: number } {
  const angle = Math.PI * (1 - value / GAUGE_MAX);
  return { x: CX + radius * Math.cos(angle), y: CY - radius * Math.sin(angle) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The server tick as a semicircle dial (the owner's pick, option A): an arc filled up to the value in
 * the tick's tone, the needle at the value, clamped to 0-30. Static (nothing moves, so reduced motion
 * needs nothing), our own SVG, colours from tokens via currentColor, and hidden from screen readers:
 * the text beside it carries the value.
 */
export function TickGauge({ rate, health = "healthy" }: { rate: number; health?: "healthy" | "slow" }) {
  const clamped = Math.min(Math.max(rate, 0), GAUGE_MAX);
  const tone = tickTone({ rate, health });
  const end = point(clamped, R);
  const mark = [point(SLOW_BELOW, R - 6), point(SLOW_BELOW, R + 6)];
  const needle = point(clamped, R - 12);
  return (
    <svg
      viewBox="0 0 120 68"
      aria-hidden="true"
      data-gauge={clamped}
      data-tone={tone}
      className="w-28 flex-none"
      fill="none"
    >
      <path d={`M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}`} className="text-line" stroke="currentColor" strokeWidth={8} />
      {Number.isFinite(clamped) && clamped > 0 && (
        <path
          d={`M${CX - R} ${CY} A${R} ${R} 0 0 1 ${round(end.x)} ${round(end.y)}`}
          className={toneClass(tone)}
          stroke="currentColor"
          strokeWidth={8}
          data-zone="value"
        />
      )}
      {/* Where a slow tick turns bad: a neutral mark, never a red zone (a healthy dial shows no red). */}
      <path
        d={`M${round(mark[0].x)} ${round(mark[0].y)} L${round(mark[1].x)} ${round(mark[1].y)}`}
        className="text-muted"
        stroke="currentColor"
        strokeWidth={1.5}
        data-zone="slow"
      />
      <line
        x1={CX}
        y1={CY}
        x2={round(needle.x)}
        y2={round(needle.y)}
        className="text-fg-strong"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r={4} className="text-fg-strong" fill="currentColor" />
    </svg>
  );
}
