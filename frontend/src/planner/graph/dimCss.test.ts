import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom does not compute CSS custom properties, so this reads the rule's source: what a dimmed group redefines.
const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
const overrides = (kind: string): Map<string, string> => {
  const block = new RegExp(`\\[data-dim-kind="${kind}"\\]\\[data-dim\\]\\s*\\{([^}]*)\\}`).exec(css);
  expect(block, kind).not.toBeNull();
  return new Map([...block![1]!.matchAll(/(--color-[\w-]+):\s*var\((--[\w-]+)\)/g)].map((m) => [m[1]!, m[2]!]));
};

describe("dimming CSS (ADR-0063 Decision 3)", () => {
  it("greys every colour token a dimmed line's children read, the moving transport glyph's stroke-fg included", () => {
    const line = overrides("line");
    // Belt (muted), pipe (info), mixed (warn), the pulse (fg-strong), the moving glyph (fg).
    for (const token of ["--color-muted", "--color-info", "--color-warn", "--color-fg-strong", "--color-fg"]) expect(line.get(token), token).toBe("--color-graph-dim-line");
    // An unknown rate's line and the glyph's halo stay as they are: already quiet.
    expect(line.has("--color-line")).toBe(false);
  });

  it("turns a dimmed card's words muted and its own outlines grey, and leaves state tones, the accent ring and the line colour alone", () => {
    const card = overrides("card");
    expect([...card.keys()].sort()).toEqual(["--color-fg", "--color-fg-strong", "--color-graph-card-edge", "--color-surface-2"]);
    // The raised fill sinks to the canvas's surface (Decision 3's fallback); muted words on it are pinned at 4.5:1 in lineWidth.test.ts.
    expect(card.get("--color-surface-2")).toBe("--color-surface");
    expect(card.get("--color-fg")).toBe("--color-muted");
    expect(card.get("--color-fg-strong")).toBe("--color-muted");
    // Outlines (a frame, its rows, the pills) go the dim grey; muted words keep muted, so they stay at 4.5:1.
    expect(card.get("--color-graph-card-edge")).toBe("--color-graph-dim-line");
  });
});
