// The design-token rule (the owner's, 2026-09-26): colours, sizes, radii, z-index, breakpoints and
// motion are named tokens in the `@theme` block of src/index.css; components reference them.
// This finds the raw values that break it. Pure, so design-tokens.test.mjs can pin each rule;
// check-design-tokens.mjs runs it over src/ as part of `npm run lint`.
//
// Escape hatch: `design-token-allow: <reason>` in a comment on the offending line or the line
// above. The reason is required, and a hatch that covers nothing is itself an error.

const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
// A number with a unit: a length, a time or an angle. `fr` and unitless numbers are layout, not design values.
// Tailwind writes spaces as `_` and calc() operators as `-`, so only letters and digits bound it.
const UNIT_VALUE = /(?<![A-Za-z0-9.])\d*\.?\d+(?:px|rem|em|ex|ch|lh|vh|vw|svh|dvh|lvh|vmin|vmax|%|ms|s|deg|turn)(?![A-Za-z0-9])/;
const MOTION_FN = /\b(?:cubic-bezier|steps|linear)\(/;
const ALLOW = /design-token-allow:(.*)$/;

/** Tailwind classes with a bracketed value (`min-h-[44px]`, `max-[600px]:`) or an arbitrary property (`[transition:...]`). */
const BRACKET = /(?<![\w\]])(?:-?[a-z][\w-]*-)?\[([^\]\s]+)\]/g;
const Z_CLASS = /(?<![\w-])-?z-\d+(?![\w-])/;
const TIMING_CLASS = /(?<![\w-])(?:duration|delay)-\d+(?![\w-])/;
/** A string literal that is only a CSS length or time, e.g. `style={{ width: "24rem" }}`. */
const RAW_STRING = /(["'`])-?\d*\.?\d+(?:px|rem|em|vh|vw|svh|dvh|ms|s)\1/;

const isComment = (line) => /^\s*(?:\/\/|\/\*|\*|\{\/\*)/.test(line);

function scriptProblems(line) {
  const problems = [];
  if (isComment(line)) return problems;
  for (const match of line.matchAll(BRACKET)) {
    const inner = match[1];
    if (UNIT_VALUE.test(inner) || HEX.test(inner) || COLOR_FN.test(inner) || MOTION_FN.test(inner)) {
      problems.push(`bracketed raw value \`${match[0]}\``);
    }
  }
  const quotedHex = line.match(/(["'`])#[0-9a-fA-F]{3,8}\1/);
  if (quotedHex) problems.push(`raw colour ${quotedHex[0]}`);
  if (COLOR_FN.test(line.replace(BRACKET, ""))) problems.push("raw colour function");
  if (MOTION_FN.test(line.replace(BRACKET, ""))) problems.push("raw easing function");
  const z = line.match(Z_CLASS);
  if (z) problems.push(`raw z-index \`${z[0]}\``);
  const timing = line.match(TIMING_CLASS);
  if (timing) problems.push(`raw timing \`${timing[0]}\``);
  const raw = line.match(RAW_STRING);
  if (raw) problems.push(`raw size or time ${raw[0]}`);
  return problems;
}

function cssProblems(line) {
  const problems = [];
  const code = line.replace(/\/\*.*?\*\//g, "");
  if (HEX.test(code)) problems.push("raw hex colour");
  if (COLOR_FN.test(code)) problems.push("raw colour function");
  if (MOTION_FN.test(code)) problems.push("raw easing function");
  if (/\bz-index\s*:\s*-?\d/.test(code)) problems.push("raw z-index");
  if (/\b(?:transition|animation)[\w-]*\s*:[^;]*\d(?:ms|s)\b/.test(code)) problems.push("raw duration or delay");
  return problems;
}

/** Lines inside `@theme { ... }` are the token definitions, so they may hold raw values. */
function themeLines(lines) {
  const inside = new Set();
  let depth = 0;
  let open = false;
  lines.forEach((line, i) => {
    if (!open && /^\s*@theme\b[^{]*\{/.test(line)) {
      open = true;
      depth = 0;
    }
    if (!open) return;
    inside.add(i);
    for (const ch of line.replace(/\/\*.*?\*\//g, "")) {
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
    }
    if (depth === 0) open = false;
  });
  return inside;
}

/**
 * @param {string} file path, used to pick the rules (`.css` or script) and in messages
 * @param {string} text the file's contents
 * @returns {{ violations: {line: number, message: string}[], exceptions: {line: number, reason: string}[], errors: {line: number, message: string}[] }}
 */
export function checkDesignTokens(file, text) {
  const lines = text.split(/\r?\n/);
  const css = file.endsWith(".css");
  const skip = css ? themeLines(lines) : new Set();
  const violations = [];
  const exceptions = [];
  const errors = [];
  const usedAllows = new Set();

  const allowAt = (i) => {
    const m = i >= 0 ? lines[i].match(ALLOW) : null;
    return m ? { index: i, reason: m[1].replace(/\*\/|\}|-->/g, "").trim() } : null;
  };

  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    const problems = css ? cssProblems(line) : scriptProblems(line);
    if (problems.length === 0) return;
    const allow = allowAt(i) ?? allowAt(i - 1);
    if (allow && allow.reason) {
      usedAllows.add(allow.index);
      exceptions.push({ line: i + 1, reason: allow.reason });
      return;
    }
    for (const message of problems) violations.push({ line: i + 1, message });
  });

  lines.forEach((line, i) => {
    const allow = allowAt(i);
    if (!allow) return;
    if (!allow.reason) errors.push({ line: i + 1, message: "design-token-allow needs a reason after the colon" });
    else if (!usedAllows.has(i)) errors.push({ line: i + 1, message: "design-token-allow covers no raw value; remove it" });
  });

  return { violations, exceptions, errors };
}
