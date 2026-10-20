/// <reference types="node" />
// Node types for reading index.css itself: Vitest stubs CSS imports, `?raw` included.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LOGO_ICONS, logoColors, logoSvg, themeColors, webManifest, type LogoColors } from "./logoMark";
import { StationIcon } from "./StationIcon";

const CSS = readFileSync(join(import.meta.dirname, "..", "index.css"), "utf8");
const COLORS: LogoColors = { canvas: "#000001", body: "#000002", stroke: "#000003", lit: "#000004" };

function parse(svg: string) {
  return new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
}

/** Each drawn shape's geometry, ignoring colours: its tag and the attributes that place it. */
function shapes(root: Element) {
  return [...root.querySelectorAll("path, rect")]
    .filter((el) => !el.hasAttribute("data-backdrop"))
    .map((el) => [el.tagName, ...["d", "x", "y", "width", "height", "rx"].map((a) => el.getAttribute(a))].join(" "));
}

describe("themeColors", () => {
  it("reads the colour tokens from index.css's @theme block", () => {
    const colors = themeColors(CSS);
    expect(colors.get("canvas")).toBe("#17191c");
    expect(colors.get("accent")).toBe("#fa9549");
    expect(colors.get("surface-2")).toBe("#2b3035");
    expect(colors.get("muted")).toBe("#a3a9ae");
  });

  it("ignores colours outside @theme", () => {
    const colors = themeColors("@theme {\n  --color-a: #111111;\n}\n:root { --color-b: #222222; }");
    expect([...colors.keys()]).toEqual(["a"]);
  });
});

describe("logoColors", () => {
  it("takes StationIcon's token colours: canvas, steel body, muted outline, amber light", () => {
    expect(logoColors(CSS)).toEqual({ canvas: "#17191c", body: "#2b3035", stroke: "#a3a9ae", lit: "#fa9549" });
  });

  it("fails loudly when a token is missing or not a hex colour, never draws a wrong icon", () => {
    expect(() => logoColors("@theme {\n  --color-canvas: #17191c;\n}")).toThrow(/surface-2/);
    expect(() => logoColors(CSS.replace("--color-accent: #fa9549", "--color-accent: var(--x)"))).toThrow(/accent/);
  });
});

describe("logoSvg", () => {
  it("draws the same factory as StationIcon, one source for the app and the icons", () => {
    const { container } = render(<StationIcon kind="factory" />);
    expect(shapes(parse(logoSvg(COLORS)))).toEqual(shapes(container.querySelector("svg")!));
  });

  it("colours with exactly the given colours, as attributes (a standalone file has no CSS)", () => {
    const svg = logoSvg(COLORS);
    expect(new Set(svg.match(/#[0-9a-f]{6}/g))).toEqual(new Set(Object.values(COLORS)));
    expect(svg).not.toContain("class=");
    expect(parse(svg).getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
  });

  it("sits on a canvas backdrop: rounded for the favicon, square for the app icons", () => {
    const rounded = parse(logoSvg(COLORS, { rounded: true })).querySelector("[data-backdrop]")!;
    const square = parse(logoSvg(COLORS)).querySelector("[data-backdrop]")!;
    expect(rounded.getAttribute("fill")).toBe(COLORS.canvas);
    expect(Number(rounded.getAttribute("rx"))).toBeGreaterThan(0);
    expect(square.getAttribute("rx")).toBe("0");
  });

  it("centres the mark with a margin, inside the 48 x 48 viewBox", () => {
    const mark = parse(logoSvg(COLORS)).querySelector("g")!;
    const [, tx, ty, s] = mark.getAttribute("transform")!.match(/translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)/)!.map(Number);
    // The factory's outline spans x 5-38 and y 8-42 in StationIcon's viewBox.
    const left = tx + 5 * s;
    const right = tx + 38 * s;
    const top = ty + 8 * s;
    const bottom = ty + 42 * s;
    expect(left).toBeCloseTo(48 - right, 2);
    expect(top).toBeCloseTo(48 - bottom, 2);
    expect(top).toBeGreaterThanOrEqual(4);
  });
});

describe("webManifest", () => {
  it("names the app, starts in it, and lists every generated icon", () => {
    const manifest = webManifest({ canvas: "#17191c" });
    expect(manifest.name).toBe("Satis Manager");
    expect(manifest.start_url).toBe("/app");
    expect(manifest.background_color).toBe("#17191c");
    expect(manifest.theme_color).toBe("#17191c");
    expect(manifest.icons).toEqual(
      LOGO_ICONS.filter((icon) => icon.manifest).map(({ file, size }) => ({ src: `/${file}`, sizes: `${size}x${size}`, type: "image/png" })),
    );
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });
});
