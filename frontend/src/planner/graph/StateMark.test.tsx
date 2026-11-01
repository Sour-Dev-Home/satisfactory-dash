import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { machineState } from "../../factory/machineState";
import type { StalledKind } from "../plannerText";
import { StateMark, StateMarkGlyph } from "./StateMark";

const KINDS: StalledKind[] = ["backedUp", "underfed", "paused", "idle"];

const drawGlyph = (kind: StalledKind) =>
  render(
    <svg>
      <StateMarkGlyph kind={kind} />
    </svg>,
  ).container.querySelector(`[data-state-mark="${kind}"]`);

describe("StateMarkGlyph", () => {
  it("draws a distinct shape for each kind, hidden from assistive tech", () => {
    const shapes = new Set<string>();
    for (const kind of KINDS) {
      const g = drawGlyph(kind);
      expect(g?.tagName.toLowerCase()).toBe("g");
      expect(g?.getAttribute("aria-hidden")).toBe("true");
      const d = [...(g?.querySelectorAll("path") ?? [])].map((p) => p.getAttribute("d")).join("|");
      expect(d).not.toBe("");
      shapes.add(d);
    }
    expect(shapes.size).toBe(KINDS.length);
  });

  it("strokes in the state's own tone token from machineState, never a raw colour", () => {
    for (const kind of KINDS) {
      const g = drawGlyph(kind)!;
      expect(g.getAttribute("class")).toContain(machineState(kind)!.tone);
      expect(g.getAttribute("class")).toContain("stroke-current");
      expect(g.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|style=/i);
    }
  });

  it("draws nothing for a kind this build doesn't know", () => {
    const { container } = render(
      <svg>
        <StateMarkGlyph kind={"unpowered" as StalledKind} />
      </svg>,
    );
    expect(container.querySelector("[data-state-mark]")).toBeNull();
  });
});

describe("StateMark", () => {
  it("wraps the glyph in an aria-hidden, unfocusable inline svg on the glyph box", () => {
    const { container } = render(<StateMark kind="paused" className="text-xs" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("viewBox")).toBe("-12 -12 24 24");
    expect(svg.getAttribute("class")).toContain("text-xs");
    expect(svg.querySelector('[data-state-mark="paused"]')).not.toBeNull();
  });

  it("renders nothing for an unknown kind", () => {
    expect(render(<StateMark kind={"mystery" as StalledKind} />).container.innerHTML).toBe("");
  });
});

describe("the marks' contrast (WCAG 1.4.11, 3:1 for a graphic)", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  const hex = (token: string): string => {
    const value = new RegExp(`^\\s*--color-${token}:\\s*(#[0-9a-f]{6});`, "im").exec(css)?.[1];
    if (value === undefined) throw new Error(`--color-${token} is not a hex token in src/index.css`);
    return value;
  };
  const luminance = (colour: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(colour.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("clears 3:1 on every surface a card or bubble is drawn on", () => {
    for (const kind of KINDS) {
      const token = machineState(kind)!.tone.replace(/^text-/, "");
      for (const surface of ["canvas", "surface", "surface-2"]) expect(ratio(hex(token), hex(surface)), `${kind} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});
