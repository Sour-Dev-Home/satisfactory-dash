import { describe, expect, it } from "vitest";
import { highlightOf, pointerStore, sameTarget, targetAt, targetId, type Highlight } from "./lineHighlight";

// ADR-0063 amendment (2026-11-03): what a pointed-at line or card lights, and the pointer's store outside React state.
const edges = [
  { index: 0, flow: { from: "a", to: "b" } },
  { index: 3, flow: { from: "b", to: "c" } },
  { index: 5, flow: { from: "d", to: "b" } },
  { index: 7, flow: { from: "c", to: "e" } },
];
const cards = new Set(["a", "b", "c", "d", "e", "lone"]);
const sorted = (hl: Highlight | null) => (hl === null ? null : { edges: [...hl.edges].sort((x, y) => x - y), cards: [...hl.cards].sort() });

describe("highlightOf", () => {
  it("lights a line and its two cards, nothing else", () => {
    expect(sorted(highlightOf({ kind: "edge", index: 3 }, edges, cards))).toEqual({ edges: [3], cards: ["b", "c"] });
  });

  it("lights a card with every line in or out of it and their far cards (hop-1)", () => {
    expect(sorted(highlightOf({ kind: "card", key: "b" }, edges, cards))).toEqual({ edges: [0, 3, 5], cards: ["a", "b", "c", "d"] });
  });

  it("lights a card with no lines alone", () => {
    expect(sorted(highlightOf({ kind: "card", key: "lone" }, edges, cards))).toEqual({ edges: [], cards: ["lone"] });
  });

  it("lights a self-loop's card once", () => {
    expect(sorted(highlightOf({ kind: "card", key: "x" }, [{ index: 1, flow: { from: "x", to: "x" } }], new Set(["x"])))).toEqual({ edges: [1], cards: ["x"] });
  });

  it("is nothing for no target, or one a poll took away", () => {
    expect(highlightOf(null, edges, cards)).toBeNull();
    expect(highlightOf({ kind: "edge", index: 99 }, edges, cards)).toBeNull();
    expect(highlightOf({ kind: "card", key: "gone" }, edges, cards)).toBeNull();
  });
});

describe("sameTarget", () => {
  it("compares by kind and identity", () => {
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget({ kind: "edge", index: 1 }, { kind: "edge", index: 1 })).toBe(true);
    expect(sameTarget({ kind: "edge", index: 1 }, { kind: "edge", index: 2 })).toBe(false);
    expect(sameTarget({ kind: "card", key: "1" }, { kind: "edge", index: 1 })).toBe(false);
    expect(sameTarget({ kind: "card", key: "a" }, { kind: "card", key: "a" })).toBe(true);
    expect(sameTarget({ kind: "card", key: "a" }, null)).toBe(false);
  });
});

const NS = "http://www.w3.org/2000/svg";
function picture(): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  const add = (parent: Element, attrs: Record<string, string>) => {
    const g = document.createElementNS(NS, "g");
    for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v);
    parent.append(g);
    return g;
  };
  add(svg, { "data-hl-edge": "0" });
  add(svg, { "data-hl-edge": "0", "data-edge-label": "0" }).append(document.createElementNS(NS, "text"));
  add(svg, { "data-hl-edge": "3" });
  add(svg, { "data-hl-node": "a" });
  const b = add(svg, { "data-hl-node": "b" });
  add(b, { "data-inside": "" });
  add(svg, { "data-hl-node": 'q"uote' });
  add(svg, { "data-hl-edge": "", "data-empty": "" });
  return svg;
}

describe("targetAt", () => {
  it("finds the line or the card an element is in, else nothing", () => {
    const svg = picture();
    expect(targetAt(svg.querySelector("[data-edge-label] text"))).toEqual({ kind: "edge", index: 0 });
    expect(targetAt(svg.querySelector("[data-inside]"))).toEqual({ kind: "card", key: "b" });
    expect(targetAt(svg.querySelector('[data-hl-node="q\\"uote"]'))).toEqual({ kind: "card", key: 'q"uote' });
    // A malformed index is no target, never edge 0.
    expect(targetAt(svg.querySelector("[data-empty]"))).toBeNull();
    expect(targetAt(svg)).toBeNull();
    expect(targetAt(null)).toBeNull();
  });
});

describe("pointerStore", () => {
  it("tells its subscribers only when the target changes, and stops after unsubscribing", () => {
    const store = pointerStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    expect(store.get()).toBeNull();
    store.set({ kind: "edge", index: 1 });
    // The pointer moving over the same line's other parts: the same target, no news.
    store.set({ kind: "edge", index: 1 });
    expect(calls).toBe(1);
    store.set({ kind: "card", key: "a" });
    store.set(null);
    store.set(null);
    expect(calls).toBe(3);
    expect(store.get()).toBeNull();
    off();
    store.set({ kind: "edge", index: 2 });
    expect(calls).toBe(3);
    expect(store.get()).toEqual({ kind: "edge", index: 2 });
  });

  it("gives each target its own id, so a new one's rates fade in afresh", () => {
    expect(targetId({ kind: "edge", index: 3 })).toBe("e:3");
    expect(targetId({ kind: "card", key: "3" })).toBe("c:3");
  });
});
