import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { cn } from "../../lib/cn";
import { bubbleName, itemRateText, type BubbleItem, type BubbleStop, type ItemFocus } from "./bubbleRow";
import type { CanvasFlow } from "./canvasScene";
import { itemIconUrl } from "./itemIcons";

/** Where arrow keys and Home/End move from stop `i` of `n`, or null for a key the layer leaves alone. */
function nextStop(key: string, i: number, n: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(n - 1, i + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, i - 1);
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

/**
 * The keyboard's way into the item bubbles (ADR-0060 Decision 5): a visually hidden button per bubble and per "+k" chip,
 * one tab stop for all of them (a roving tabindex), arrow keys, Home and End to move. Enter or Space activates; Escape goes
 * on to the viewport, which leaves focus mode. The canvas is `role="img"`, so these are its only exposed controls.
 */
export function BubbleButtons({
  stops,
  names,
  active,
  focus,
  listOpen,
  buttons,
  onActivate,
  onFocusStop,
}: {
  stops: readonly BubbleStop[];
  names: ReadonlyMap<string, string>;
  /** The stop that holds the tab stop: the last one focused, else the first. */
  active: string | null;
  focus: ItemFocus | null;
  /** The line whose "+k" list is open. */
  listOpen: string | null;
  buttons: MutableRefObject<Map<string, HTMLButtonElement>>;
  onActivate: (stop: BubbleStop) => void;
  onFocusStop: (stop: BubbleStop | null) => void;
}) {
  if (stops.length === 0) return null;
  const tabStop = stops.some((s) => s.id === active) ? active : stops[0].id;
  const onKeyDown = (event: KeyboardEvent, i: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const to = nextStop(event.key, i, stops.length);
    if (to === null) return;
    // The viewport would pan on these keys: here they move between bubbles.
    event.preventDefault();
    event.stopPropagation();
    buttons.current.get(stops[to].id)?.focus();
  };
  return (
    <ul aria-label="Items on the lines" className="m-0 list-none p-0">
      {stops.map((s, i) => (
        <li key={s.id}>
          <button
            type="button"
            ref={(el) => {
              if (el) buttons.current.set(s.id, el);
              else buttons.current.delete(s.id);
            }}
            tabIndex={s.id === tabStop ? 0 : -1}
            aria-expanded={s.item === null ? listOpen === s.edgeKey : focus !== null && focus.edgeKey === s.edgeKey && focus.item === s.item}
            onClick={() => onActivate(s)}
            onKeyDown={(e) => onKeyDown(e, i)}
            onFocus={() => onFocusStop(s)}
            onBlur={() => onFocusStop(null)}
            className="sr-only"
          >
            {names.get(s.id) ?? ""}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One row's icon in the list: the 32 px file, or the initials on the same chip when there is none or it fails. */
function ListIcon({ item }: { item: BubbleItem }) {
  const url = item.className === null ? undefined : itemIconUrl(item.className, 32);
  const [failed, setFailed] = useState(false);
  return (
    <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-icon-chip text-xs text-surface">
      {url !== undefined && !failed ? <img src={url} alt="" width={24} height={24} onError={() => setFailed(true)} /> : item.text}
    </span>
  );
}

/**
 * A line's full item list, opened from its "+k" chip (owner answer 5): every item, each focusable like a bubble. A
 * non-modal panel beside the canvas, in the group panel's place; Escape or Close closes it and returns to the chip.
 */
export function ItemList({
  id,
  flow,
  items,
  from,
  to,
  focus,
  onFocusItem,
  onClose,
}: {
  id: string;
  flow: CanvasFlow;
  items: readonly BubbleItem[];
  from: string;
  to: string;
  focus: ItemFocus | null;
  onFocusItem: (item: BubbleItem) => void;
  onClose: () => void;
}) {
  const headingId = `${id}-heading`;
  // Opened from the chip, the list takes the keyboard to its first item; Escape anywhere in it closes it.
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onClose();
      }}
      className="flex h-full flex-col"
    >
      {/* The header stays put while the list scrolls under it (CanvasOverlay), so Close is always in reach. */}
      <div data-overlay-header="" className="flex shrink-0 items-start justify-between gap-2 border-b border-transparent px-4 pt-4 pb-3 group-data-scrolled:border-line">
        <h3 id={headingId} className="m-0 text-base font-semibold">{`${items.length} items from ${from} to ${to}`}</h3>
        <button type="button" onClick={onClose} className="min-h-touch">
          Close
        </button>
      </div>
      {/* Focusable, so a keyboard can scroll it (axe scrollable-region-focusable). */}
      <div data-overlay-body="" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ul className="m-0 flex list-none flex-col gap-1 px-4 pt-0 pb-4">
          {items.map((item, i) => {
            const on = focus !== null && focus.item === item.key;
            return (
              <li key={item.key}>
                <button
                  ref={i === 0 ? first : undefined}
                  type="button"
                  aria-label={bubbleName(item, flow.unit, from, to)}
                  aria-pressed={on}
                  onClick={() => onFocusItem(item)}
                  className={cn("flex min-h-touch w-full items-center gap-2 rounded-md px-2 text-left", on && "bg-surface-2")}
                >
                  <ListIcon item={item} />
                  <span className="min-w-0 flex-1">{item.name ?? "Item unknown"}</span>
                  <span className="text-sm text-muted">{itemRateText(item, flow.unit)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
