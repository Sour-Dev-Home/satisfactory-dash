import { cn } from "../lib/cn";
import {
  FACTORY_BODY,
  FACTORY_DOOR,
  FACTORY_WINDOWS,
  MACHINE_FEET,
  MACHINE_HOUSING,
  MACHINE_LIGHT,
  MACHINE_PORT,
  MACHINE_WINDOW,
  STATION_VIEWBOX,
} from "./stationShapes";

export type StationKind = "server" | "power" | "factory" | "machine";

/**
 * A station (ADR-0041 item 5): drawn like the case-study figures in the owner's portfolio, a steel body
 * with dark panels and an amber detail. Ours, inline, colours from tokens only. Amber is the accent,
 * never a status, so an icon never says whether its area is healthy: the text beside it does.
 * Decorative (`aria-hidden`) unless `title` names it.
 */
export function StationIcon({
  kind,
  size = 32,
  title,
  className,
}: {
  kind: StationKind;
  /** Width and height in CSS pixels. */
  size?: number;
  /** Gives the icon an accessible name; without it the icon is hidden from screen readers. */
  title?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${STATION_VIEWBOX} ${STATION_VIEWBOX}`}
      width={size}
      height={size}
      data-station={kind}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
      className={cn("flex-none", className)}
      strokeWidth={1.5}
      strokeLinejoin="round"
    >
      {title && <title>{title}</title>}
      <Body kind={kind} />
    </svg>
  );
}

/** The parts each station is made of: body (steel), dark (panels and windows), lit (the amber detail). */
const BODY = "fill-surface-2 stroke-muted";
const DARK = "fill-canvas";
const LIT = "fill-accent";

function Body({ kind }: { kind: StationKind }) {
  switch (kind) {
    case "server":
      // A rack: three units, a light on each.
      return (
        <>
          <rect className={BODY} x="8" y="5" width="32" height="38" rx="3" />
          {[10, 21, 32].map((y) => (
            <g key={y}>
              <rect className={DARK} x="12" y={y} width="24" height="7" rx="1.5" />
              <circle className={LIT} cx="31" cy={y + 3.5} r="1.6" />
            </g>
          ))}
        </>
      );
    case "power":
      // A power pole's box with a bolt on it.
      return (
        <>
          <rect className={BODY} x="7" y="7" width="34" height="34" rx="4" />
          <circle className={DARK} cx="24" cy="24" r="13" />
          <path className={LIT} d="M26.5 13 17.5 26h6l-2 9 9-13h-6z" />
        </>
      );
    case "factory":
      // A saw-tooth roof, a stack and a lit door.
      return (
        <>
          <path className={BODY} d={FACTORY_BODY} />
          {FACTORY_WINDOWS.map((pane) => (
            <rect key={pane.x} className={DARK} {...pane} />
          ))}
          <rect className={LIT} {...FACTORY_DOOR} />
        </>
      );
    case "machine":
      // A machine: a housing, its window and an output port. The map draws the same shapes (stationShapes.ts).
      return (
        <>
          <rect className={BODY} {...MACHINE_HOUSING} />
          <rect className={DARK} {...MACHINE_WINDOW} />
          <rect className={BODY} {...MACHINE_PORT} />
          <circle className={LIT} {...MACHINE_LIGHT} />
          <path className={BODY} d={MACHINE_FEET} />
        </>
      );
  }
}
