import { describe, expect, it } from "vitest";
import { checkDesignTokens } from "./design-tokens.mjs";

const tsx = (line) => checkDesignTokens("src/x.tsx", line);
const css = (text) => checkDesignTokens("src/index.css", text);

describe("design-token lint, components", () => {
  // Every raw value the 2026-09-26 audit moved into tokens.
  it.each([
    'className="min-h-[44px]"',
    'className="min-w-[44px]"',
    'className="px-[14px]"',
    'const link = "-my-[calc((44px-1lh)/2)] inline-flex";',
    'className="h-[279px] sm:h-[250px]"',
    'className="h-[60svh] min-h-[320px]"',
    'className="max-[600px]:hidden"',
    'className="min-[601px]:hidden"',
    'className="md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]"',
    'className="absolute z-10"',
  ])("flags %s", (line) => {
    expect(tsx(line).violations).not.toHaveLength(0);
  });

  it.each([
    'className="bg-[#1f2937]"',
    'className="bg-[rgb(0_0_0/0.5)]"',
    'className="[transition:opacity_180ms_ease]"',
    'className="ease-[cubic-bezier(0.2,0,0,1)]"',
    'className="transition duration-200 delay-75"',
    'const color = "#fff";',
    'ctx.fillStyle = "rgb(255 0 0)";',
    'style={{ width: "24rem" }}',
    'style={{ animationDuration: "250ms" }}',
  ])("flags %s", (line) => {
    expect(tsx(line).violations).not.toHaveLength(0);
  });

  it.each([
    'className="min-h-touch min-w-touch px-button-x -my-touch-bleed"',
    'className="md:grid-cols-[minmax(0,var(--spacing-overview-rail))_minmax(0,1fr)]"',
    'className="grid-cols-[max-content_1fr]"',
    'className="aria-[invalid=true]:border-bad"',
    'className="z-(--z-popover) max-table-rows:hidden"',
    'className="p-4 gap-2.5 rounded-md shadow-lg motion-safe:animate-pulse"',
    "const first = rows[0];",
    "// see #193 and rgb(1 2 3) in the notes",
    "{/* the 44 px target (#62) */}",
    'stroke: token("--color-muted")',
    // A bare (unquoted) numeric style prop isn't a length/time literal, so it's out of the
    // raw-string rule's documented scope ("string literals that are only a length or time").
    "style={{ zIndex: 999 }}",
    // A string that mixes a unit value with other text isn't "only a length or time" either.
    'style={{ transition: "opacity 200ms ease" }}',
    'style={{ margin: "4px 8px" }}',
  ])("allows %s", (line) => {
    expect(tsx(line).violations).toEqual([]);
  });

  // A z-index is a design value even without a unit, bracketed or not.
  it.each(['className="z-[999]"', 'className="-z-[5]"'])("flags %s", (line) => {
    expect(tsx(line).violations).not.toHaveLength(0);
  });

  it("flags each bad line inside a multi-line cn() call independently", () => {
    const text = ['const cls = cn(', '  "base",', '  isActive && "z-10",', '  "mt-[4px]"', ");"].join("\n");
    const result = tsx(text);
    expect(result.violations.map((v) => v.line)).toEqual([3, 4]);
  });

  it("counts a same-line JSX comment hatch as an exception", () => {
    const result = tsx('className="w-[37px]" {/* design-token-allow: legacy asset */}');
    expect(result.violations).toEqual([]);
    expect(result.exceptions).toEqual([{ line: 1, reason: "legacy asset" }]);
  });
});

// The fresh-eyes pass (2026-09-26) found these false positives; comments are now stripped first.
describe("design-token lint, comments and formatting", () => {
  it("does not treat code inside a trailing `//` comment as a raw-value violation", () => {
    expect(tsx("const foo = doThing(); // migrated off z-10 last week").violations).toEqual([]);
    expect(tsx('const bar = 2; // was "#ff8a82" before').violations).toEqual([]);
    expect(tsx("const x = 1; // e.g. min-h-[44px] on mobile").violations).toEqual([]);
  });

  it("still scans code after a `//` inside a string", () => {
    expect(tsx('<a href="https://example.com" className="z-10" />').violations).not.toHaveLength(0);
  });

  it("does not let an apostrophe in JSX text hide the next line", () => {
    const text = ["<p>Don't panic</p>", '<div className="min-h-[44px]" />'].join("\n");
    expect(tsx(text).violations.map((v) => v.line)).toEqual([2]);
  });

  it("scans class names inside a multi-line template literal", () => {
    const text = ["const cls = `", "  grid", "  h-[250px]", "`;"].join("\n");
    expect(tsx(text).violations.map((v) => v.line)).toEqual([3]);
  });

  it("does not scan the tail of a multi-line JS/TSX block comment as code", () => {
    const text = ["/* TODO fix", "this z-10 class */"].join("\n");
    expect(tsx(text).violations).toEqual([]);
  });

  it("does not scan the tail of a multi-line CSS comment as a declaration", () => {
    const text = ["/* raw color reference", "   #fff */"].join("\n");
    expect(css(text).violations).toEqual([]);
  });

  it("recognises an @theme block whose opening brace is on its own line", () => {
    const text = ["@theme", "{", "  --color-bad: #f2564d;", "}", "a { color: #000; }"].join("\n");
    expect(css(text).violations.map((v) => v.line)).toEqual([5]);
  });
});

describe("design-token lint, CSS", () => {
  it("allows raw values inside @theme only", () => {
    const text = [
      "@theme {",
      "  --color-bad: #f2564d;",
      "  --color-bad-edge: rgb(242 86 77 / 0.35);",
      "}",
      ".banner { color: #ff8a82; }",
      ".edge { border-color: rgb(242 86 77 / 0.35); }",
    ].join("\n");
    expect(css(text).violations.map((v) => v.line)).toEqual([5, 6]);
  });

  it("does not end the @theme block at a nested brace", () => {
    const text = ["@theme {", "  --a: 1px;", "  @keyframes x { from { opacity: 0 } }", "  --b: #fff;", "}", "a { color: #000; }"].join("\n");
    expect(css(text).violations.map((v) => v.line)).toEqual([6]);
  });

  it.each([
    "a { z-index: 50; }",
    "a { transition: opacity 180ms ease; }",
    "a { animation-duration: 0.2s; }",
    "a { transition-timing-function: cubic-bezier(0.2, 0, 0, 1); }",
  ])("flags %s", (line) => {
    expect(css(line).violations).not.toHaveLength(0);
  });

  it("allows tokens and comments", () => {
    expect(css("a { color: var(--color-bad); } /* was #ff8a82 */").violations).toEqual([]);
  });
});

describe("design-token lint, escape hatch", () => {
  it("counts a reasoned hatch on the line or the line above as an exception", () => {
    const same = tsx('className="w-[37px]" // design-token-allow: matches the vendor logo box');
    expect(same.violations).toEqual([]);
    expect(same.exceptions).toEqual([{ line: 1, reason: "matches the vendor logo box" }]);

    const above = checkDesignTokens("src/x.tsx", '{/* design-token-allow: third-party widget size */}\n<div className="h-[123px]" />');
    expect(above.violations).toEqual([]);
    expect(above.exceptions).toHaveLength(1);
  });

  it("rejects a hatch without a reason", () => {
    const result = tsx('className="w-[37px]" // design-token-allow:');
    expect(result.violations).not.toHaveLength(0);
    expect(result.errors).toEqual([{ line: 1, message: expect.stringContaining("needs a reason") }]);
  });

  it("rejects a hatch that covers nothing", () => {
    const result = tsx('className="w-4" // design-token-allow: left over');
    expect(result.errors).toEqual([{ line: 1, message: expect.stringContaining("covers no raw value") }]);
  });

  it("works in CSS comments", () => {
    const result = css("/* design-token-allow: Leaflet's own control colour */\n.x { color: #fff; }");
    expect(result.violations).toEqual([]);
    expect(result.exceptions).toEqual([{ line: 2, reason: "Leaflet's own control colour" }]);
  });
});
