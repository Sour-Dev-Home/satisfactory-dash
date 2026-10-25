import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransportGlyph } from "./transportGlyphs";
import { GLYPH_MODES } from "./transportModes";

const glyph = (mode: string) => render(<svg>{<TransportGlyph mode={mode} />}</svg>).container.querySelector("[data-glyph]")!;

describe("TransportGlyph", () => {
  it("draws a distinct shape for each mode the build knows, centred on the origin and hidden from assistive tech", () => {
    const shapes = new Set<string>();
    for (const mode of GLYPH_MODES) {
      const g = glyph(mode);
      expect(g.getAttribute("data-glyph")).toBe(mode);
      expect(g.getAttribute("aria-hidden")).toBe("true");
      expect(g.querySelector("circle[r]")).not.toBeNull();
      shapes.add(g.innerHTML);
    }
    expect(shapes.size).toBe(GLYPH_MODES.length);
  });

  it("styles with token classes and attributes only, never a style attribute or a raw colour", () => {
    for (const mode of [...GLYPH_MODES, "hyperloop"]) {
      const g = glyph(mode);
      expect(g.querySelector("[style]")).toBeNull();
      expect(g.outerHTML).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i);
      expect(g.querySelector(".stroke-fg")).not.toBeNull();
    }
  });

  it("falls back to an arrow for a mode it does not know, including names that are on Object.prototype", () => {
    for (const mode of ["hyperloop", "toString", "__proto__", "constructor", ""]) {
      expect(glyph(mode).getAttribute("data-glyph")).toBe("other");
    }
  });
});
