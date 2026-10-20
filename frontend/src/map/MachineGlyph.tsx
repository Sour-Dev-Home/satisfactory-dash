import { MACHINE_HOUSING, MACHINE_WINDOW, STATION_VIEWBOX, svgPoints, WARNING_TRIANGLE } from "../ui/stationShapes";

/**
 * The map legend's machine icon: the same shapes the canvas draws (machineIcon.ts) and StationIcon
 * uses, coloured by a token fill class (`fill-ok`...). Decorative: the label beside it names it.
 */
export function MachineGlyph({
  fill,
  outline,
  backedUp = false,
}: {
  fill: string;
  /** A stroke class (`stroke-muted`): the hollow form (with `fill-none`), 1 px as on the canvas, no window. */
  outline?: string;
  backedUp?: boolean;
}) {
  return (
    <svg viewBox={`0 0 ${STATION_VIEWBOX} ${STATION_VIEWBOX}`} aria-hidden="true" focusable="false" className="size-5 flex-none">
      <rect
        className={outline ? `${fill} ${outline}` : fill}
        {...(outline && { strokeWidth: 1, vectorEffect: "non-scaling-stroke" })}
        {...MACHINE_HOUSING}
      />
      {backedUp ? (
        <polygon className="fill-canvas" points={svgPoints(WARNING_TRIANGLE)} />
      ) : (
        !outline && <rect className="fill-canvas" {...MACHINE_WINDOW} />
      )}
    </svg>
  );
}
