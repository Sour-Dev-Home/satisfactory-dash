import { useState, type KeyboardEvent, type MutableRefObject } from "react";
import { cn } from "../../lib/cn";
import { machineState } from "../../factory/machineState";
import { BuildingGlyph, GLYPH_BOX } from "./buildingGlyphs";
import { buildingIconUrl, type GlyphKind } from "./buildingIcons";
import { capDash, capStroke, capWidth, slotText, type CapMarch, type CapStop } from "./capLayout";
import { capQuality, capSlots, capStep } from "./capModel";
import type { Card } from "./canvasScene";
import { CAP_D, capSlotAt } from "./layoutSite";
import { PULSE_DASH, PULSE_MIN_W } from "./marching";
import type { RateStep } from "./rateStep";
import { nextStop } from "./rovingStop";

/**
 * Destination caps (ADR-0062 Decision 1): a card's footer row, one cap per kind of end its flows reach that no line is drawn
 * to. A cap is a short stub ending in a disc with the destination's art (or glyph), a number badge past one flow, and past
 * `CAPS_MAX` kinds a "+k" cap. The stub's dashes travel toward the disc at the cap's `rateStep`, the lines' own function, so a
 * line and its cap agree: measured moves (pulses over a solid stub), estimated moves (its dashed stub marches), unknown is a
 * still dotted stub, stalled is still. The canvas draws every cap still (`CapRow`); the moving part is drawn in SiteGraph's
 * march layer (`CapMarchStroke`), never inside the canvas, whose every animated path repainted the whole canvas each frame
 * (ADR-0062 amendment, the march layer fix). Words: each cap's `<title>` and its button (`capText`), so speed never carries
 * the rate alone. The geometry and the choice of what moves are `capLayout.ts`.
 */

/** The art of a destination kind: a building's icon where one stands for it, else a generic glyph. Maps: the kinds are server strings. */
const CAP_ICON_CLASS: ReadonlyMap<string, string> = new Map([
  ["storage", "Build_StorageContainerMk1_C"],
  ["depot", "Build_CentralStorage_C"],
  ["sink", "Build_ResourceSink_C"],
]);
const CAP_GLYPH: ReadonlyMap<string, GlyphKind> = new Map([
  ["storage", "storage"],
  ["depot", "storage"],
  ["sink", "consumer"],
  ["power", "power"],
  ["export", "station"],
]);
/** The art drawn in a cap's disc, this many units square (the 24-unit glyph box scaled to it). */
const CAP_ICON = 14;
/** The glyph's stroke in its own 24-unit box, so it draws about 1.5 units at the disc's size. */
const CAP_GLYPH_STROKE = 2.5;
/** The number badge: a pill this tall, centred this far right of and above the disc's centre, each digit this wide. */
const CAP_BADGE_H = 16;
const CAP_BADGE_AT = 8;
const CAP_BADGE_CHAR_W = 7;
/** A stalled cap's ring (marks mode), as thin as a stalled bubble's; the keyboard's ring is the accent, thicker. */
const CAP_STALLED_RING_W = 2.5;
const CAP_RINGED_W = 3;

const MARCH_CLASS: ReadonlyMap<RateStep, string> = new Map([
  ["slow", "animate-flow-slow"],
  ["mid", "animate-flow-mid"],
  ["fast", "animate-flow-fast"],
]);
const PULSE_CLASS: ReadonlyMap<RateStep, string> = new Map([
  ["slow", "animate-flow-pulse-slow"],
  ["mid", "animate-flow-pulse-mid"],
  ["fast", "animate-flow-pulse-fast"],
]);

const badgeText = (count: number): string => (count > 99 ? "99+" : String(count));
const badgeWidth = (text: string): number => Math.max(CAP_BADGE_H, text.length * CAP_BADGE_CHAR_W + 6);

/** A cap's moving part in the march layer: an estimated stub's own dashes, or a measured stub's pulses, travelling to the disc. */
export function CapMarchStroke({ cap: c, dim }: { cap: CapMarch; dim: boolean }) {
  const d = `M${c.x0} ${c.y}H${c.x1}`;
  return (
    <g data-march-cap={c.id} data-march-step={c.step} className={cn("transition-opacity", dim && "opacity-graph-dim")}>
      {c.quality === "estimated" ? (
        <path d={d} fill="none" strokeWidth={c.width} strokeDasharray={capDash("estimated")} data-march={c.step} className={cn(c.stroke, MARCH_CLASS.get(c.step))} />
      ) : (
        <path
          d={d}
          fill="none"
          strokeWidth={Math.max(PULSE_MIN_W, c.width / 2)}
          strokeDasharray={PULSE_DASH}
          data-march={c.step}
          data-march-pulse=""
          className={cn("stroke-fg-strong opacity-0", PULSE_CLASS.get(c.step))}
        />
      )}
    </g>
  );
}

/** The disc's picture: the building's icon, or the kind's glyph (also when the file fails), or "?" for an unknown end. */
function CapArt({ destination, cx, cy }: { destination: string; cx: number; cy: number }) {
  const className = CAP_ICON_CLASS.get(destination);
  const url = className === undefined ? undefined : buildingIconUrl(className);
  const [failed, setFailed] = useState(false);
  if (url !== undefined && !failed) {
    return <image href={url} x={cx - CAP_ICON / 2} y={cy - CAP_ICON / 2} width={CAP_ICON} height={CAP_ICON} data-cap-art="image" onError={() => setFailed(true)} />;
  }
  return (
    <g transform={`translate(${cx} ${cy}) scale(${CAP_ICON / GLYPH_BOX})`} data-cap-art="glyph">
      {/* Dark on the light chip (as the "+k" text), and heavier: scaled to the disc, the default 1.75 would draw about 1 unit. */}
      <BuildingGlyph kind={CAP_GLYPH.get(destination) ?? "unknown"} tone="stroke-surface" strokeWidth={CAP_GLYPH_STROKE} />
    </g>
  );
}

/**
 * A card's footer row, drawn in the card (its units): every slot still. `marching` holds the slots the march layer moves:
 * an estimated one's dashed stub is left out here (the layer draws it moving, in the same place); a measured one's solid
 * stub stays and the layer's pulses ride over it. `ringed` is the slot whose button the keyboard is on.
 */
export function CapRow({
  card,
  lines,
  marks,
  marching,
  ringed,
  onCap,
}: {
  card: Card;
  lines: number;
  /** The state style is marks (ADR-0062 Decision 2): a stalled cap's disc wears its state's ring. */
  marks: boolean;
  marching: ReadonlySet<number> | undefined;
  ringed: number | null;
  onCap: () => void;
}) {
  if (card.caps === undefined || card.caps.length === 0) return null;
  const choose = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onCap();
  };
  return (
    <g data-cap-row="">
      {capSlots(card.caps).map((s, i) => {
        const at = capSlotAt(i, lines);
        const ring = ringed === i;
        if (s.kind === "more") {
          return (
            <g key={`more|${i}`} data-cap-more={s.more.length} onClick={choose}>
              <title>{slotText(s)}</title>
              <circle cx={at.cx} cy={at.cy} r={CAP_D / 2} strokeWidth={ring ? CAP_RINGED_W : 1} className={cn("fill-icon-chip", ring ? "stroke-accent" : "stroke-line")} />
              <text x={at.cx} y={at.cy} textAnchor="middle" dominantBaseline="central" className="fill-surface text-xs">
                {`+${s.more.length}`}
              </text>
            </g>
          );
        }
        const cap = s.cap;
        const quality = capQuality(cap);
        const step = capStep(cap);
        const stalled = marks ? cap.stalled : undefined;
        const omitStub = quality === "estimated" && marching?.has(i) === true;
        const badge = cap.count > 1 ? badgeText(cap.count) : null;
        return (
          <g
            key={`${cap.destination}|${i}`}
            data-cap={cap.destination}
            data-cap-quality={quality}
            data-cap-step={step ?? "still"}
            data-cap-stalled={cap.stalled}
            data-cap-count={cap.count}
            onClick={choose}
          >
            <title>{slotText(s)}</title>
            {!omitStub && (
              <path d={`M${at.x0} ${at.cy}H${at.x1}`} fill="none" strokeWidth={capWidth(cap)} strokeDasharray={capDash(quality)} data-cap-stub="" className={capStroke(cap)} />
            )}
            <circle
              cx={at.cx}
              cy={at.cy}
              r={CAP_D / 2}
              strokeWidth={ring ? CAP_RINGED_W : stalled !== undefined ? CAP_STALLED_RING_W : 1}
              data-cap-ring={stalled}
              className={cn("fill-icon-chip", ring ? "stroke-accent" : stalled !== undefined ? cn("stroke-current", machineState(stalled)?.tone ?? "text-muted") : "stroke-line")}
            />
            <CapArt destination={cap.destination} cx={at.cx} cy={at.cy} />
            {badge !== null && (
              <g data-cap-badge={badge} transform={`translate(${at.cx + CAP_BADGE_AT - badgeWidth(badge) / 2} ${at.cy - CAP_BADGE_AT - CAP_BADGE_H / 2})`}>
                <rect width={badgeWidth(badge)} height={CAP_BADGE_H} rx={CAP_BADGE_H / 2} strokeWidth={1} className="fill-surface stroke-line" />
                <text x={badgeWidth(badge) / 2} y={CAP_BADGE_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg-strong text-xs font-semibold">
                  {badge}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * The keyboard's way to the caps (ADR-0062 Decision 1): a visually hidden button per cap, one tab stop for all of them (a
 * roving tabindex, like the item bubbles), arrow keys, Home and End to move. Enter or Space shows the card's detail, which
 * lists every destination in words. The canvas is `role="img"`, so these are the caps' only exposed controls.
 */
export function CapButtons({
  stops,
  active,
  buttons,
  onActivate,
  onFocusStop,
}: {
  stops: readonly CapStop[];
  /** The stop that holds the tab stop: the last one focused, else the first. */
  active: string | null;
  buttons: MutableRefObject<Map<string, HTMLButtonElement>>;
  onActivate: (stop: CapStop) => void;
  onFocusStop: (stop: CapStop | null) => void;
}) {
  if (stops.length === 0) return null;
  const tabStop = stops.some((s) => s.id === active) ? active : stops[0].id;
  const onKeyDown = (event: KeyboardEvent, i: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const to = nextStop(event.key, i, stops.length);
    if (to === null) return;
    // The viewport would pan on these keys: here they move between caps.
    event.preventDefault();
    event.stopPropagation();
    buttons.current.get(stops[to].id)?.focus();
  };
  return (
    <ul aria-label="Where the cards' flows end" className="m-0 list-none p-0">
      {stops.map((s, i) => (
        <li key={s.id}>
          <button
            type="button"
            ref={(el) => {
              if (el) buttons.current.set(s.id, el);
              else buttons.current.delete(s.id);
            }}
            tabIndex={s.id === tabStop ? 0 : -1}
            data-cap-button={s.id}
            onClick={() => onActivate(s)}
            onKeyDown={(e) => onKeyDown(e, i)}
            onFocus={() => onFocusStop(s)}
            onBlur={() => onFocusStop(null)}
            className="sr-only"
          >
            {s.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
