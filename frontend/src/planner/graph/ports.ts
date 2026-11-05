import { itemKeyOf, itemRateText, summedQuality } from "./bubbleRow";
import type { CanvasFlow } from "./canvasScene";
import type { FlowQuality } from "./hierarchy";

// ADR-0063 Decision 1: a card's end of the lines of one item on one side is a port, a small item disc on the card's edge.
// Pure: which ports each card has, which port each line's ends attach to, and the fold past the cap. Their order down an
// edge is the router's (it knows where each line goes next); this module only says what exists.

/** The disc, centred on the card's edge (half outside): a cap's disc's size (`CAP_D`). */
export const PORT_D = 20;
/** The icon inside it, from the 32 px item file. */
export const PORT_ICON = 16;
/**
 * One port per this many units down an edge: two label rows (`LABEL_LINE_H`) round the widest line (`TRANSPORT_W`), a gap
 * between each row and its line, and a clearance between one port's rate row and the next one's name row (build PR 3
 * draws those labels). The inequality is pinned in ports.test.ts.
 */
export const PORT_PITCH = 48;
export const END_LABEL_ROW_GAP = 3;
export const END_LABEL_CLEAR = 4;
/** A port's centre keeps this far from the card's top and bottom: clear of the count badge and a pill's 44-high target. */
export const PORT_INSET = 44 / 2 + PORT_D / 2;
/** Ports per edge: past it, the items of lowest summed rate fold into one "+N" port. */
export const PORTS_MAX = 6;

export type Side = "l" | "r";

/** One item a port stands for (a fold stands for several). */
export interface PortItem {
  key: string;
  name: string | null;
  className: string | null;
  /** The summed known rate of its lines at this card (unknown rates count as 0), for the order and the fold. */
  rate: number;
}

export interface Port {
  /** Unique in the scene: card, side, direction and item ("+" for the fold). */
  id: string;
  card: string;
  side: Side;
  /** "in" when lines arrive here, "out" when they leave. A return flow's ports are the other way round from their side's. */
  dir: "in" | "out";
  /** A return flow's port (left for out, right for in): ordered after the others on its edge. */
  returning: boolean;
  /** The item key, or "+" for the fold. */
  item: string;
  /** Its items: one, or the fold's. */
  items: PortItem[];
  /** The drawn flows (indexes) that attach here. */
  flows: number[];
  /** Their summed known rate, and how sure that sum is (ADR-0053 Decision 3: weakest wins, "at least" with a part missing). */
  rate: number;
  quality: FlowQuality;
}

/** Which ports a line's two ends attach to, and on which side of each card. */
export interface FlowEnds {
  src: string;
  tgt: string;
  srcSide: Side;
  tgtSide: Side;
}

export interface PortModel {
  ports: Port[];
  /** Per drawn flow, in the order given. */
  ends: FlowEnds[];
}

const known = (f: Pick<CanvasFlow, "quality" | "ratePerMinute">): boolean => f.quality !== "unknown" && f.ratePerMinute !== null && Number.isFinite(f.ratePerMinute);
const byRateThenName = (a: { rate: number; name: string | null }, b: { rate: number; name: string | null }) => b.rate - a.rate || (a.name ?? "￿").localeCompare(b.name ?? "￿");

/**
 * The ports of a scene's drawn lines. A forward line leaves its source's right edge and enters its target's left; a return
 * flow (`returns`, from `returnFlows`) leaves its source's left and enters its target's right. Past `PORTS_MAX` ports on
 * one edge, the `PORTS_MAX - 1` items of highest summed rate (then name) keep theirs and the rest fold into one "+N" port.
 */
export function portModel(drawn: readonly CanvasFlow[], returns: ReadonlySet<number>): PortModel {
  // Per card edge (card, side, dir): its items in first-seen order, each with its flows and rate.
  type Slot = { card: string; side: Side; dir: "in" | "out"; returning: boolean; items: Map<string, PortItem & { flows: number[] }> };
  const slots = new Map<string, Slot>();
  const slotOf = (card: string, side: Side, dir: "in" | "out", returning: boolean): Slot => {
    const key = [card, side, dir].join("\u0001");
    let s = slots.get(key);
    if (s === undefined) {
      s = { card, side, dir, returning, items: new Map() };
      slots.set(key, s);
    }
    return s;
  };
  const add = (slot: Slot, f: CanvasFlow, i: number) => {
    const key = f.portItem ?? itemKeyOf(f);
    const rate = known(f) ? f.ratePerMinute! : 0;
    const seen = slot.items.get(key);
    if (seen === undefined) {
      const name = f.itemName === null || f.itemName === "" ? null : f.itemName;
      const className = f.itemClassName === null || f.itemClassName === "" ? null : f.itemClassName;
      slot.items.set(key, { key, name, className, rate, flows: [i] });
    } else {
      seen.rate += rate;
      seen.flows.push(i);
    }
  };
  const sides = drawn.map((_, i): { srcSide: Side; tgtSide: Side } => (returns.has(i) ? { srcSide: "l", tgtSide: "r" } : { srcSide: "r", tgtSide: "l" }));
  drawn.forEach((f, i) => {
    const back = returns.has(i);
    add(slotOf(f.from, sides[i].srcSide, "out", back), f, i);
    add(slotOf(f.to, sides[i].tgtSide, "in", back), f, i);
  });

  // Fold past the cap, per side of a card (in and out on one side share the edge, so they share the cap).
  const perSide = new Map<string, Slot[]>();
  for (const s of slots.values()) {
    const k = [s.card, s.side].join("\u0001");
    perSide.set(k, [...(perSide.get(k) ?? []), s]);
  }
  const ports: Port[] = [];
  const portOfFlow = new Map<string, string>();
  const idOf = (s: Slot, item: string) => [s.card, s.side, s.dir, item].join("\u0001");
  for (const list of perSide.values()) {
    const all = list.flatMap((s) => [...s.items.values()]);
    const keep = new Set(all.length <= PORTS_MAX ? all : [...all].sort(byRateThenName).slice(0, PORTS_MAX - 1));
    for (const s of list) {
      const folded: (PortItem & { flows: number[] })[] = [];
      for (const it of s.items.values()) {
        if (!keep.has(it)) {
          folded.push(it);
          continue;
        }
        const id = idOf(s, it.key);
        ports.push({
          id,
          card: s.card,
          side: s.side,
          dir: s.dir,
          returning: s.returning,
          item: it.key,
          items: [{ key: it.key, name: it.name, className: it.className, rate: it.rate }],
          flows: it.flows,
          rate: it.rate,
          quality: summedQuality(it.flows.map((f) => drawn[f])),
        });
        for (const f of it.flows) portOfFlow.set(`${f}\u0001${s.dir}`, id);
      }
      if (folded.length > 0) {
        const id = idOf(s, "+");
        const flows = folded.flatMap((it) => it.flows);
        ports.push({
          id,
          card: s.card,
          side: s.side,
          dir: s.dir,
          returning: s.returning,
          item: "+",
          items: [...folded].sort(byRateThenName).map(({ key, name, className, rate }) => ({ key, name, className, rate })),
          flows,
          rate: folded.reduce((sum, it) => sum + it.rate, 0),
          quality: summedQuality(flows.map((f) => drawn[f])),
        });
        for (const f of flows) portOfFlow.set(`${f}\u0001${s.dir}`, id);
      }
    }
  }
  const ends = drawn.map((_, i): FlowEnds => ({ src: portOfFlow.get(`${i}\u0001out`)!, tgt: portOfFlow.get(`${i}\u0001in`)!, ...sides[i] }));
  return { ports, ends };
}

/**
 * A port's `<title>` for pointer hover (Decision 1, "Not a target"): "Iron Plate in, 120 items/min"; a fold lists its items
 * ("2 items in: Screw, Rotor, …"), with a rate only when they share one unit (items and m³ are never added).
 */
export function portTitle(p: Pick<Port, "item" | "items" | "dir" | "rate" | "quality"> & { unit: CanvasFlow["unit"] | null }): string {
  const rate = p.unit === null ? null : itemRateText({ rate: p.rate, quality: p.quality }, p.unit);
  if (p.item === "+") {
    const names = p.items.map((i) => i.name ?? "Item unknown").join(", ");
    return `${p.items.length} items ${p.dir}: ${names}${rate === null ? "" : `, ${rate}`}`;
  }
  return `${p.items[0]?.name ?? "Item unknown"} ${p.dir}, ${rate ?? "rate unknown"}`;
}

/** How many ports each card has on its fuller side: what its height must hold. */
export function portsPerCard(model: PortModel): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of model.ports) {
    const k = [p.card, p.side].join("\u0001");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const [k, n] of counts) {
    const card = k.split("\u0001")[0];
    out.set(card, Math.max(out.get(card) ?? 0, n));
  }
  return out;
}

/** The least card height that holds `n` ports down one edge, each `PORT_INSET` clear of the top and bottom. */
export const portsHeight = (n: number): number => (n <= 0 ? 0 : (n - 1) * PORT_PITCH + 2 * PORT_INSET);

/** The ports' centres down an edge of a card `height` tall, in order: `PORT_PITCH` apart, centred on the edge. */
export function portOffsets(n: number, height: number): number[] {
  return Array.from({ length: n }, (_, j) => height / 2 + (j - (n - 1) / 2) * PORT_PITCH);
}
