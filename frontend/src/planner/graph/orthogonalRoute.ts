// ADR-0059: the planner's orthogonal edge router over dagre's left-to-right layered layout. Dagre puts every card and every edge's dummy points (one per rank an edge passes, its label's
// among them) in columns, with each dummy in a slot of its own; so an edge can run horizontally through each column at
// its dummy's height, and change height only in the gaps between columns, which hold no cards. The router gives every
// such change its own vertical track in its gap (ordered to cross as little as possible, the gap widened when the tracks
// do not fit), and starts and ends each edge on the side of its card, several ends on one side spread evenly.

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export interface RouteCard extends Box {
  key: string;
}

export interface RouteEdge {
  from: string;
  to: string;
  /** The layout's points between the two cards, source to target (dagre's dummies, without its two end points). */
  waypoints: Point[];
  /** Which waypoint is the label's (it must stay on the route); undefined when none. */
  label?: number | undefined;
}

export interface RouteInput {
  cards: RouteCard[];
  edges: RouteEdge[];
  /** Each edge's label box (top-left), or undefined: they widen their column and block straightened runs. */
  labels: (Box | undefined)[];
  /** Boxes that only move with the columns (frames). */
  frames?: Box[];
}

export interface RouteOptions {
  /** The least room between two tracks, and between a track and a column. */
  track?: number;
  /**
   * Straighten: let an edge keep its height across columns where its dummies sat elsewhere (dagre parks rank-skipping
   * dummies away from the straight line), when nothing else is at that height there. The label's dummy is kept.
   */
  straighten?: boolean;
  /** The clearance a straightened run keeps from cards, labels and other edges' runs. */
  clearance?: number;
}

export interface RouteOutput {
  cards: RouteCard[];
  labels: (Box | undefined)[];
  frames: Box[];
  /** Each edge's orthogonal polyline, from its source card's side to its target card's side. */
  paths: Point[][];
  /** How much wider the gaps were made, in all. */
  widened: number;
  /** Vertical tracks used, in all. */
  tracks: number;
}

interface Level {
  col: number;
  y: number;
  must: boolean;
  /** A straightened level that keeps the height of an end (so it moves with that end's port). */
  follow?: "src" | "tgt" | undefined;
}

interface Leg {
  edge: number;
  /** The leg runs between levels `at` and `at + 1` of its edge. */
  at: number;
  /** The heights on the gap's left side and right side. */
  yl: number;
  yr: number;
}

const cx = (b: Box) => b.x + b.width / 2;
const cy = (b: Box) => b.y + b.height / 2;

/** Sorted column centres: the x values, those within `tol` of each other as one. */
function columnsOf(xs: readonly number[], tol = 1): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of sorted) if (out.length === 0 || x - out[out.length - 1] > tol) out.push(x);
  return out;
}

/** How badly leg `a` left of leg `b` crosses: a height strictly inside the other's span is a crossing, at its end a touch. */
function inside(y: number, leg: Leg): number {
  const lo = Math.min(leg.yl, leg.yr);
  const hi = Math.max(leg.yl, leg.yr);
  if (y > lo + 1e-6 && y < hi - 1e-6) return 1;
  return Math.abs(y - lo) < 1e-6 || Math.abs(y - hi) < 1e-6 ? 0.5 : 0;
}
const leftOfCost = (a: Leg, b: Leg) => inside(b.yl, a) + inside(a.yr, b);

/** The legs of one gap, left to right: each inserted where it adds the least crossing. */
export function orderTracks<T extends Leg>(legs: readonly T[]): T[] {
  const order: T[] = [];
  const sorted = [...legs].sort((a, b) => (a.yl + a.yr) / 2 - (b.yl + b.yr) / 2 || a.edge - b.edge);
  for (const leg of sorted) {
    let best = 0;
    let bestCost = Infinity;
    for (let p = 0; p <= order.length; p++) {
      let cost = 0;
      for (let i = 0; i < p; i++) cost += leftOfCost(order[i], leg);
      for (let i = p; i < order.length; i++) cost += leftOfCost(leg, order[i]);
      if (cost < bestCost) {
        bestCost = cost;
        best = p;
      }
    }
    order.splice(best, 0, leg);
  }
  return order;
}

export function routeOrthogonal(input: RouteInput, options: RouteOptions = {}): RouteOutput {
  const TRACK = options.track ?? 8;
  const CLEAR = options.clearance ?? 10;
  const cards = input.cards.map((c) => ({ ...c }));
  const labels = input.labels.map((b) => (b === undefined ? undefined : { ...b }));
  const byKey = new Map(cards.map((c) => [c.key, c]));

  // Columns, and how far each reaches either side of its centre.
  let centres = columnsOf([...cards.map(cx), ...input.edges.flatMap((e) => e.waypoints.map((p) => p.x))]);
  const colOf = (x: number) => {
    let best = 0;
    for (let i = 1; i < centres.length; i++) if (Math.abs(centres[i] - x) < Math.abs(centres[best] - x)) best = i;
    return best;
  };
  const half = centres.map(() => 0);
  for (const c of cards) half[colOf(cx(c))] = Math.max(half[colOf(cx(c))], c.width / 2);
  for (const b of labels) if (b !== undefined) half[colOf(cx(b))] = Math.max(half[colOf(cx(b))], b.width / 2);

  // Each edge as the heights it runs at, one level per column it crosses (its ends at their cards' centres for now).
  const levels: Level[][] = input.edges.map((e) => {
    const s = byKey.get(e.from)!;
    const t = byKey.get(e.to)!;
    return [
      { col: colOf(cx(s)), y: cy(s), must: true },
      ...e.waypoints.map((p, i) => ({ col: colOf(p.x), y: p.y, must: i === e.label })),
      { col: colOf(cx(t)), y: cy(t), must: true },
    ];
  });

  if (options.straighten === true) straighten(levels, cards, labels, colOf, CLEAR);

  // Ends: the side towards the next level, several ends on one side spread along it in the order of where they go.
  const ends = new Map<string, { edge: number; which: "src" | "tgt"; toward: number }[]>();
  const sideOf: { src: "l" | "r"; tgt: "l" | "r" }[] = levels.map((lv) => {
    const n = lv.length;
    const src = lv[1].col >= lv[0].col ? "r" : "l";
    const tgt = lv[n - 2].col <= lv[n - 1].col ? "l" : "r";
    return { src, tgt };
  });
  input.edges.forEach((e, i) => {
    const lv = levels[i];
    const add = (key: string, side: "l" | "r", which: "src" | "tgt", toward: number) => {
      const k = `${key}\u0001${side}`;
      ends.set(k, [...(ends.get(k) ?? []), { edge: i, which, toward }]);
    };
    add(e.from, sideOf[i].src, "src", lv[1].y);
    add(e.to, sideOf[i].tgt, "tgt", lv[lv.length - 2].y);
  });
  for (const [k, list] of ends) {
    const card = byKey.get(k.split("\u0001")[0])!;
    list.sort((a, b) => a.toward - b.toward || a.edge - b.edge);
    list.forEach((end, j) => {
      const y = card.y + (card.height * (j + 1)) / (list.length + 1);
      const lv = levels[end.edge];
      const at = end.which === "src" ? 0 : lv.length - 1;
      lv[at].y = y;
      for (const l of lv) if (l.follow === end.which) l.y = y;
    });
  }

  // Legs, by gap (gap g lies between columns g and g + 1).
  const legsByGap = new Map<number, Leg[]>();
  levels.forEach((lv, e) => {
    for (let k = 0; k + 1 < lv.length; k++) {
      const a = lv[k];
      const b = lv[k + 1];
      if (Math.abs(a.y - b.y) < 1e-6) continue;
      const g = b.col > a.col ? a.col : b.col < a.col ? a.col - 1 : Math.min(a.col, centres.length - 2);
      const leg: Leg = b.col >= a.col ? { edge: e, at: k, yl: a.y, yr: b.y } : { edge: e, at: k, yl: b.y, yr: a.y };
      legsByGap.set(g, [...(legsByGap.get(g) ?? []), leg]);
    }
  });

  // Widen the gaps whose tracks do not fit, moving every column right of it.
  const extra = centres.map(() => 0);
  for (const [g, legs] of legsByGap) {
    if (g < 0 || g + 1 >= centres.length) continue;
    const room = centres[g + 1] - half[g + 1] - (centres[g] + half[g]);
    extra[g] = Math.max(0, (legs.length + 1) * TRACK - room);
  }
  const bounds = centres.slice(0, -1).map((c, g) => (c + centres[g + 1]) / 2);
  const shift = (x: number) => x + bounds.reduce((s, b, g) => (b < x ? s + extra[g] : s), 0);
  for (const c of cards) c.x += shift(cx(c)) - cx(c);
  for (const b of labels) if (b !== undefined) b.x += shift(cx(b)) - cx(b);
  const frames = (input.frames ?? []).map((f) => {
    const left = shift(f.x);
    return { ...f, x: left, width: shift(f.x + f.width) - left };
  });
  centres = centres.map(shift);

  // Tracks: each gap's legs in order, evenly spread across it.
  const trackX = new Map<string, number>();
  let tracks = 0;
  for (const [g, legs] of legsByGap) {
    const gl = g >= 0 ? centres[g] + half[g] : centres[0] - half[0] - (legs.length + 1) * TRACK;
    const gr = g + 1 < centres.length ? centres[g + 1] - half[g + 1] : gl + (legs.length + 1) * TRACK;
    orderTracks(legs).forEach((leg, i) => trackX.set(`${leg.edge}\u0001${leg.at}`, gl + ((gr - gl) * (i + 1)) / (legs.length + 1)));
    tracks += legs.length;
  }

  const paths = levels.map((lv, e) => {
    const s = byKey.get(input.edges[e].from)!;
    const t = byKey.get(input.edges[e].to)!;
    const pts: Point[] = [{ x: sideOf[e].src === "r" ? s.x + s.width : s.x, y: lv[0].y }];
    for (let k = 0; k + 1 < lv.length; k++) {
      const x = trackX.get(`${e}\u0001${k}`);
      if (x === undefined) continue;
      pts.push({ x, y: lv[k].y }, { x, y: lv[k + 1].y });
    }
    pts.push({ x: sideOf[e].tgt === "l" ? t.x : t.x + t.width, y: lv[lv.length - 1].y });
    return pts;
  });
  return { cards, labels, frames, paths, widened: extra.reduce((a, b) => a + b, 0), tracks };
}

/**
 * Keep an edge at one height across columns where dagre parked its dummies elsewhere, when that height is free there: no
 * card or label box within `clear`, and no other edge's level within `clear`. Greedy, edge by edge, farthest run first;
 * the label's level and the ends stay.
 */
function straighten(levels: Level[][], cards: readonly RouteCard[], labels: readonly (Box | undefined)[], colOf: (x: number) => number, clear: number): void {
  const cardsByCol = new Map<number, Box[]>();
  for (const c of cards) cardsByCol.set(colOf(cx(c)), [...(cardsByCol.get(colOf(cx(c))) ?? []), c]);
  const labelsByCol = new Map<number, { box: Box; edge: number }[]>();
  labels.forEach((b, edge) => {
    if (b !== undefined) labelsByCol.set(colOf(cx(b)), [...(labelsByCol.get(colOf(cx(b))) ?? []), { box: b, edge }]);
  });
  const free = (col: number, y: number, edge: number) => {
    if ((cardsByCol.get(col) ?? []).some((c) => y > c.y - clear && y < c.y + c.height + clear)) return false;
    if ((labelsByCol.get(col) ?? []).some((l) => l.edge !== edge && y > l.box.y - clear && y < l.box.y + l.box.height + clear)) return false;
    return !levels.some((lv, e) => e !== edge && lv.some((l) => l.col === col && Math.abs(l.y - y) < clear));
  };
  // The label's level moves only with its box, and only where the whole box is free in its column.
  const freeLabel = (col: number, y: number, edge: number) => {
    const box = labels[edge];
    if (box === undefined) return false;
    const top = y - box.height / 2 - clear;
    const bottom = y + box.height / 2 + clear;
    const overlaps = (a: number, b: number) => a < bottom && b > top;
    if ((cardsByCol.get(col) ?? []).some((c) => overlaps(c.y, c.y + c.height))) return false;
    if ((labelsByCol.get(col) ?? []).some((l) => l.edge !== edge && overlaps(l.box.y, l.box.y + l.box.height))) return false;
    return !levels.some((lv, e) => e !== edge && lv.some((l) => l.col === col && l.y > top && l.y < bottom));
  };
  levels.forEach((lv, edge) => {
    let i = 0;
    while (i < lv.length - 1) {
      let best = i + 1;
      let bestY: number | undefined;
      let follow: Level["follow"];
      for (let j = i + 2; j < lv.length; j++) {
        const span = lv.slice(i + 1, j);
        for (const [y, f] of [
          [lv[i].y, i === 0 ? "src" : undefined],
          [lv[j].y, j === lv.length - 1 ? "tgt" : undefined],
        ] as const) {
          if (span.every((l) => (l.must ? freeLabel(l.col, y, edge) : free(l.col, y, edge)))) {
            best = j;
            bestY = y;
            follow = f;
            break;
          }
        }
      }
      if (bestY !== undefined) {
        for (let k = i + 1; k < best; k++) {
          const box = lv[k].must ? labels[edge] : undefined;
          if (box !== undefined) box.y = bestY - box.height / 2;
          lv[k].y = bestY;
          // A moved label stays where its room was checked (an end's port may sit a little off the end's centre).
          lv[k].follow = box === undefined ? follow : undefined;
        }
      }
      i = best;
    }
  });
}
