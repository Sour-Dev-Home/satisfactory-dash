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

// The second fresh-eyes pass (2026-09-26) found these: regex literals read as comments, and a
// hatch honoured outside a comment.
describe("design-token lint, regex literals and where a hatch counts", () => {
  it("does not mistake a regex character class for a block comment", () => {
    const line = 'const re = /[/*]/; className="z-10"';
    expect(tsx(line).violations).not.toHaveLength(0);
  });

  it('does not mistake an escaped slash before a regex delimiter for "//"', () => {
    const line = 'const isApi = /^\\/api\\//.test(path); className="z-10"';
    expect(tsx(line).violations).not.toHaveLength(0);
  });

  it("does not let design-token-allow inside a plain string literal act as an escape hatch", () => {
    const line = 'const help = "use design-token-allow: to suppress"; className="z-10"';
    const result = tsx(line);
    expect(result.exceptions).toEqual([]);
    expect(result.violations).not.toHaveLength(0);
  });

  it("does not let design-token-allow inside visible JSX text act as an escape hatch", () => {
    const text = ["<p>Workaround: design-token-allow: old banner</p>", '<div className="z-10" />'].join("\n");
    const result = tsx(text);
    expect(result.exceptions).toEqual([]);
    expect(result.violations.map((v) => v.line)).toEqual([2]);
  });

  it("keeps division and JSX closing tags as code", () => {
    expect(tsx('const half = total / 2; const c = "z-10"; // a / b').violations).not.toHaveLength(0);
    expect(tsx('<p>a</p> <div className="min-h-[44px]" /> {/* ok */}').violations).not.toHaveLength(0);
    expect(tsx("const r = a / b / c; // was z-10").violations).toEqual([]);
  });
});

// A third fresh-eyes pass (2026-09-26): the regex-start heuristic only fires when the `/` is
// preceded by one of a fixed set of characters (or `return`). `)` and `=>` are deliberately not
// in that set (so division reads correctly), but that means a genuine regex literal in either
// position isn't recognised as a regex at all, and its characters are scanned one at a time by
// the general block-comment check instead. If that regex contains an unescaped `/*` (e.g. a
// character class matching a slash or an asterisk, `/[/*]/`), the unconditional
// `ch === "/" && next === "*"` check still fires on the regex's own inner `/`, and the lint
// enters "block comment" mode for real — with no regex-aware `regexEnd` protecting it. Because
// `inBlock` persists across lines until an actual `*/` turns up, this can silently blank out
// every following line (hiding every later violation) instead of just the one line.
// The third fresh-eyes pass (2026-09-26) found the arrow case.
describe("design-token lint, where a regex literal can start", () => {
  it("recognises a regex right after an arrow", () => {
    const text = ['const f = (s) => /[/*]/.test(s);', 'className="z-10";'].join("\n");
    expect(tsx(text).violations.map((v) => v.line)).toEqual([2]);
  });

  // Known limit, by choice: after `)` a `/` is read as division (`(a + b) / 2` is common,
  // `if (ok) /re/.test(s);` is not), so a regex there holding `/*` opens a comment.
  it("reads a `/` after `)` as division, even before a regex", () => {
    const text = ['if (ok) /[/*]/.test(s);', 'className="z-10";'].join("\n");
    expect(tsx(text).violations).toEqual([]);
  });

  it("keeps division after `)` and after `]` as code, not a regex start", () => {
    expect(tsx('const half = (a + b) / 2; className="z-10";').violations).not.toHaveLength(0);
    expect(tsx('const half = arr[0] / 2; className="z-10";').violations).not.toHaveLength(0);
  });

  it("does not mistake a fraction in JSX text (preceded by a digit) for a regex or comment", () => {
    const text = ["<span>Map (1/2)</span>", 'className="z-10";'].join("\n");
    expect(tsx(text).violations.map((v) => v.line)).toEqual([2]);
  });

  it("falls back to plain code when a regex-start heuristic fires but no closing `/` exists on the line", () => {
    const text = ["const bad = / not closed here", 'className="z-10";'].join("\n");
    expect(tsx(text).violations.map((v) => v.line)).toEqual([2]);
  });
});

// Documents current behaviour rather than asserting a fix is needed: a design-token-allow
// reason that is split across a multi-line comment (the colon on one line, the prose on the
// next) is not honoured, because comment text is recorded per source line, not per comment.
// The result is arguably confusing (the hatch is flagged as missing a reason even though one
// exists one line down) but matches the documented contract ("a comment on the offending line
// or the line above"), which implies a single line, not a comment spanning several.
describe("design-token lint, hatch reason split across a multi-line comment", () => {
  it("does not honour a reason continued on the next line of a block comment", () => {
    const text = ["/* design-token-allow:", "   still investigating */", 'className="z-10";'].join("\n");
    const result = checkDesignTokens("src/x.tsx", text);
    expect(result.violations.map((v) => v.line)).toEqual([3]);
    expect(result.errors).toEqual([{ line: 1, message: expect.stringContaining("needs a reason") }]);
  });

  it("does not honour a reason continued on the next line of a JSX comment", () => {
    const text = ["{/* design-token-allow:", "    over multiple lines */}", 'className="z-10";'].join("\n");
    const result = checkDesignTokens("src/x.tsx", text);
    expect(result.violations.map((v) => v.line)).toEqual([3]);
    expect(result.errors).toEqual([{ line: 1, message: expect.stringContaining("needs a reason") }]);
  });

  it("honours a single-line block-comment hatch on the line above (JS style, not just JSX)", () => {
    const text = ["/* design-token-allow: legacy widget size */", 'className="z-10";'].join("\n");
    const result = checkDesignTokens("src/x.tsx", text);
    expect(result.violations).toEqual([]);
    expect(result.exceptions).toEqual([{ line: 2, reason: "legacy widget size" }]);
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

  it("takes the reason verbatim from the comment, with no HTML-comment parsing", () => {
    const result = tsx('className="w-[37px]" // design-token-allow: keeps --> and --!> as written');
    expect(result.exceptions).toEqual([{ line: 1, reason: "keeps --> and --!> as written" }]);
    const jsx = tsx('className="w-[37px]" {/* design-token-allow: vendor box --!> */}');
    expect(jsx.exceptions).toEqual([{ line: 1, reason: "vendor box --!>" }]);
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
