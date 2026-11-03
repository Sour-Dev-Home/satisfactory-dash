import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HighlightLayer } from "./HighlightLayer";
import type { LaidEdge, LaidNode } from "./layoutSite";
import { RATES_HIDE_QUERY, pointerStore } from "./lineHighlight";

// ADR-0063 amendment (2026-11-03): which target the layer follows. With no rates the layer reads no geometry, so the
// minimal shapes below are enough.
const edges = [{ index: 2, flow: { from: "a", to: "b" } }] as unknown as LaidEdge[];
const nodes = [{ key: "a" }, { key: "b" }] as unknown as LaidNode[];

function layer(store: ReturnType<typeof pointerStore>, keyTarget: Parameters<typeof HighlightLayer>[0]["keyTarget"], enabled = true) {
  return (
    <HighlightLayer
      store={store}
      keyTarget={keyTarget}
      enabled={enabled}
      edges={edges}
      nodes={nodes}
      showRates={false}
      stage={{ width: 100, height: 100 } as never}
      viewport={{ x: 0, y: 0, k: 1 } as never}
      shape="s"
      height={100}
    />
  );
}
const active = (c: HTMLElement) => c.querySelector("[data-highlight-layer]")!.getAttribute("data-highlight");

describe("HighlightLayer targets", () => {
  it("falls back to the keyboard's target when the pointer's was taken away by a poll", () => {
    const store = pointerStore();
    const { container } = render(layer(store, { kind: "card", key: "a" }));
    expect(active(container)).toBe("");
    act(() => store.set({ kind: "edge", index: 99 }));
    expect(active(container)).toBe("");
    act(() => store.set({ kind: "card", key: "gone" }));
    expect(active(container)).toBe("");
  });

  it("is off with a stale pointer target and no keyboard target, and off when disabled", () => {
    const store = pointerStore();
    const { container, rerender } = render(layer(store, null));
    act(() => store.set({ kind: "edge", index: 99 }));
    expect(active(container)).toBeNull();
    act(() => store.set({ kind: "edge", index: 2 }));
    expect(active(container)).toBe("");
    rerender(layer(store, null, false));
    expect(active(container)).toBeNull();
  });
});

describe("the rates' media rules", () => {
  it("use the one query", () => {
    const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    expect(css).toContain(`@custom-variant hover-pointer (@media ${RATES_HIDE_QUERY});`);
    expect(css).toContain(`@media ${RATES_HIDE_QUERY} {`);
  });
});
