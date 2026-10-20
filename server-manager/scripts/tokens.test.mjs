import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeToRootCss } from "./tokens.mjs";

describe("themeToRootCss", () => {
  it("keeps the top-level custom properties and drops comments and nested at-rules", () => {
    const css = `@import "x";
@theme {
  --color-a: #111; /* note; with a semicolon */
  --space-b: calc(1px +
    2px);
  @keyframes k { from { opacity: 0; } }
  --font-c: "A B", sans-serif;
}
.other { --not-me: 1; }`;
    const out = themeToRootCss(css);
    expect(out).toContain("--color-a: #111;");
    expect(out).toContain("--space-b: calc(1px + 2px);");
    expect(out).toContain('--font-c: "A B", sans-serif;');
    expect(out).not.toContain("opacity");
    expect(out).not.toContain("--not-me");
    expect(out).toMatch(/^\/\*.*\*\/\n:root \{/);
  });

  it("throws without a @theme block, an unterminated one or an empty one", () => {
    expect(() => themeToRootCss(".a{}")).toThrow(/no @theme/);
    expect(() => themeToRootCss("@theme { --a: 1;")).toThrow(/unterminated/);
    expect(() => themeToRootCss("@theme { }")).toThrow(/no custom properties/);
  });

  it("reads the dashboard's real tokens", () => {
    const out = themeToRootCss(readFileSync(new URL("../../frontend/src/index.css", import.meta.url), "utf8"));
    for (const token of ["--color-canvas", "--color-surface", "--color-ok", "--color-bad", "--radius-control", "--spacing-touch"]) {
      expect(out).toContain(`${token}:`);
    }
  });
});
