import { useLayoutEffect, useRef, useState } from "react";
import { BUBBLE_D, BUBBLE_ICON, type BubbleItem } from "./bubbleRow";
import { CARD_CLOSE, CARD_ICON, CARD_LINE_H, CARD_PAD, CARD_RX, type ItemCardText } from "./itemCardText";
import { itemIconUrl } from "./itemIcons";
import { FOCUS_CARD_H, FOCUS_CARD_W } from "./layoutSite";
import { useTween } from "./useTween";

/** The text fades in over the last part of the morph (ADR-0060 Decision 4: `t` from 0.6 to 1). */
const TEXT_FROM = 0.6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The detail card of a focused item (ADR-0060 Decision 4): one `<rect>` that a tween takes from the item's bubble (a circle
 * of `BUBBLE_D`) to the card (`FOCUS_CARD_W` × `FOCUS_CARD_H`, corner `CARD_RX`) centred on the line's label, the icon
 * growing from bubble size to the card's 128 px picture, and the words fading in at the end. Closing runs it backwards,
 * then calls `onClosed`. React renders the end state; each frame writes attributes through refs. With `ms` 0 (reduced
 * motion, Motion: Off) only the state changes. Its controls are drawn here for the pointer and are real buttons in the
 * canvas's DOM layer for the keyboard.
 */
export function ItemCard({
  item,
  text,
  cx,
  cy,
  from,
  ms,
  closing,
  onClosed,
  onClose,
  onShowPath,
}: {
  item: BubbleItem;
  text: ItemCardText;
  /** The card's centre: the line's label (the box make-room reserved). */
  cx: number;
  cy: number;
  /** The bubble it grows from. */
  from: { x: number; y: number };
  ms: number;
  closing: boolean;
  onClosed: () => void;
  onClose: () => void;
  /** Light the item's whole supply path (the item filter); absent for an unknown item. */
  onShowPath: (() => void) | undefined;
}) {
  const rect = useRef<SVGRectElement>(null);
  const icon = useRef<SVGGElement>(null);
  const words = useRef<SVGGElement>(null);
  const { run, cancel } = useTween();
  const [failed, setFailed] = useState(false);
  const url = item.className === null ? undefined : itemIconUrl(item.className, 128);
  const picture = url !== undefined && !failed;
  const x = cx - FOCUS_CARD_W / 2;
  const y = cy - FOCUS_CARD_H / 2;

  // Where everything stands at `t` (0 the bubble, 1 the card).
  const apply = (t: number) => {
    const w = lerp(BUBBLE_D, FOCUS_CARD_W, t);
    const h = lerp(BUBBLE_D, FOCUS_CARD_H, t);
    const bx = lerp(from.x - BUBBLE_D / 2, x, t);
    const by = lerp(from.y - BUBBLE_D / 2, y, t);
    rect.current?.setAttribute("x", String(bx));
    rect.current?.setAttribute("y", String(by));
    rect.current?.setAttribute("width", String(w));
    rect.current?.setAttribute("height", String(h));
    rect.current?.setAttribute("rx", String(lerp(BUBBLE_D / 2, CARD_RX, t)));
    const size = lerp(BUBBLE_ICON, CARD_ICON, t);
    const ix = lerp(from.x - BUBBLE_ICON / 2, x + CARD_PAD, t);
    const iy = lerp(from.y - BUBBLE_ICON / 2, y + CARD_PAD, t);
    icon.current?.setAttribute("transform", `translate(${ix} ${iy}) scale(${size / CARD_ICON})`);
    words.current?.setAttribute("opacity", String(Math.max(0, (t - TEXT_FROM) / (1 - TEXT_FROM))));
  };
  const settle = () => {
    icon.current?.setAttribute("transform", `translate(${x + CARD_PAD} ${y + CARD_PAD})`);
    words.current?.removeAttribute("opacity");
    for (const [k, v] of [["x", x], ["y", y], ["width", FOCUS_CARD_W], ["height", FOCUS_CARD_H], ["rx", CARD_RX]] as const) rect.current?.setAttribute(k, String(v));
  };

  // The latest geometry and callbacks, for the tween's frames (a poll can move the label while the card is open).
  const latest = useRef({ apply, settle, onClosed });
  useLayoutEffect(() => {
    latest.current = { apply, settle, onClosed };
  });

  // Open: from the bubble to the card, once per card (a new focus is a new card, keyed by its line and item), before the
  // first paint. Close: back to the bubble, then gone.
  useLayoutEffect(() => {
    if (closing) run(ms, (t) => latest.current.apply(1 - t), () => latest.current.onClosed());
    else run(ms, (t) => latest.current.apply(t), () => latest.current.settle());
    return cancel;
  }, [closing, ms, run, cancel]);

  const lineX = x + CARD_PAD;
  const linesTop = y + CARD_PAD + CARD_ICON + CARD_PAD;
  return (
    <g aria-hidden="true" data-item-card={item.className ?? "unknown"} data-closing={closing || undefined}>
      <title>{text.full}</title>
      <rect ref={rect} x={x} y={y} width={FOCUS_CARD_W} height={FOCUS_CARD_H} rx={CARD_RX} strokeWidth={1} className="fill-surface-2 stroke-accent" />
      <g ref={icon} transform={`translate(${x + CARD_PAD} ${y + CARD_PAD})`} data-icon={picture ? "image" : "text"}>
        <rect width={CARD_ICON} height={CARD_ICON} rx={CARD_ICON / 2} className="fill-icon-chip" />
        {picture ? (
          <image href={url} x={4} y={4} width={CARD_ICON - 8} height={CARD_ICON - 8} onError={() => setFailed(true)} />
        ) : (
          <text x={CARD_ICON / 2} y={CARD_ICON / 2} textAnchor="middle" dominantBaseline="central" className="fill-surface text-base font-semibold">
            {item.text}
          </text>
        )}
      </g>
      <g ref={words}>
        <text x={x + CARD_PAD + CARD_ICON + CARD_PAD} y={y + CARD_PAD + CARD_ICON / 2} dominantBaseline="central" className="fill-fg-strong text-base font-semibold">
          {text.title}
        </text>
        <text className="fill-fg text-sm">
          {text.lines.map((line, i) => (
            <tspan key={i} x={lineX} y={linesTop + CARD_LINE_H * i + CARD_LINE_H / 2} dominantBaseline="central">
              {line}
            </tspan>
          ))}
        </text>
        {onShowPath !== undefined && (
          <text x={lineX} y={y + FOCUS_CARD_H - CARD_PAD - CARD_LINE_H / 2} dominantBaseline="central" onClick={onShowPath} data-show-path="" className="cursor-pointer fill-accent text-sm underline">
            Show the whole path
          </text>
        )}
        <g transform={`translate(${x + FOCUS_CARD_W - CARD_PAD / 2 - CARD_CLOSE} ${y + CARD_PAD / 2})`} onClick={onClose} data-card-close="" className="cursor-pointer">
          <rect width={CARD_CLOSE} height={CARD_CLOSE} className="fill-transparent" />
          <path d="M7 7 L17 17 M17 7 L7 17" strokeWidth={2} strokeLinecap="round" className="stroke-fg" />
        </g>
      </g>
    </g>
  );
}
