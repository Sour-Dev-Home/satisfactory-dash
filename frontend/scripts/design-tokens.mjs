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
/** `z-10`, and `z-[999]` too: a z-index is a design value even though it has no unit. */
const Z_CLASS = /(?<![\w-])-?z-(?:\d+|\[-?\d+\])(?![\w-])/;
const TIMING_CLASS = /(?<![\w-])(?:duration|delay)-\d+(?![\w-])/;
/** A string literal that is only a CSS length or time, e.g. `style={{ width: "24rem" }}`. */
const RAW_STRING = /(["'`])-?\d*\.?\d+(?:px|rem|em|vh|vw|svh|dvh|ms|s)\1/;

/**
 * The file with its comments blanked out, line for line, so a rule never fires on prose: block
 * comments across lines, trailing `//` comments, JSX `{/* *\/}`. Strings are kept (class names live
 * there) and skipped while looking for comments, so `"https://..."` stays code. `'` and `"` strings
 * end at the line's end: an apostrophe in JSX text must not swallow the lines after it. Regex
 * literals (`/^\/api\//`, `/[/*]/`) are kept as code too. Also returns each line's comment text,
 * the only place a hatch counts.
 */
function stripComments(lines, css) {
  let inBlock = false;
  let template = false;
  const code = [];
  const comments = [];
  for (const line of lines) {
    let out = "";
    let comment = "";
    let quote = template ? "`" : null;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (inBlock) {
        if (ch === "*" && next === "/") {
          inBlock = false;
          i += 1;
        } else comment += ch;
        out += " ";
        continue;
      }
      if (quote) {
        out += ch;
        if (ch === "\\") {
          out += next ?? "";
          i += 1;
        } else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlock = true;
        out += " ";
        i += 1;
        continue;
      }
      if (!css && ch === "/" && next === "/") {
        comment += line.slice(i + 2);
        break;
      }
      if (!css && ch === "/" && /(?:^|[(,=:[!&|?{};+\-*%~^]|=>|\breturn)\s*$/.test(out)) {
        const end = regexEnd(line, i);
        if (end > i) {
          out += line.slice(i, end + 1);
          i = end;
          continue;
        }
      }
      if (ch === '"' || ch === "'" || (!css && ch === "`")) quote = ch;
      out += ch;
    }
    template = quote === "`";
    code.push(out);
    comments.push(comment);
  }
  return { code, comments };
}

/** The index of the `/` closing a regex literal that opens at `start`, or -1 if none on this line. */
function regexEnd(line, start) {
  let inClass = false;
  for (let i = start + 1; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\") i += 1;
    else if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i;
  }
  return -1;
}

function scriptProblems(code) {
  const problems = [];
  for (const match of code.matchAll(BRACKET)) {
    const inner = match[1];
    if (UNIT_VALUE.test(inner) || HEX.test(inner) || COLOR_FN.test(inner) || MOTION_FN.test(inner)) {
      problems.push(`bracketed raw value \`${match[0]}\``);
    }
  }
  const quotedHex = code.match(/(["'`])#[0-9a-fA-F]{3,8}\1/);
  if (quotedHex) problems.push(`raw colour ${quotedHex[0]}`);
  if (COLOR_FN.test(code.replace(BRACKET, ""))) problems.push("raw colour function");
  if (MOTION_FN.test(code.replace(BRACKET, ""))) problems.push("raw easing function");
  const z = code.match(Z_CLASS);
  if (z) problems.push(`raw z-index \`${z[0]}\``);
  const timing = code.match(TIMING_CLASS);
  if (timing) problems.push(`raw timing \`${timing[0]}\``);
  const raw = code.match(RAW_STRING);
  if (raw) problems.push(`raw size or time ${raw[0]}`);
  return problems;
}

function cssProblems(code) {
  const problems = [];
  if (HEX.test(code)) problems.push("raw hex colour");
  if (COLOR_FN.test(code)) problems.push("raw colour function");
  if (MOTION_FN.test(code)) problems.push("raw easing function");
  if (/\bz-index\s*:\s*-?\d/.test(code)) problems.push("raw z-index");
  if (/\b(?:transition|animation)[\w-]*\s*:[^;]*\d(?:ms|s)\b/.test(code)) problems.push("raw duration or delay");
  return problems;
}

/**
 * Lines of `@theme { ... }` (the token definitions, which may hold raw values), from the
 * `@theme` line to its closing brace, even when the `{` sits on a later line.
 */
function themeLines(code) {
  const inside = new Set();
  let open = false;
  let started = false;
  let depth = 0;
  code.forEach((line, i) => {
    if (!open && /^\s*@theme\b/.test(line)) {
      open = true;
      started = false;
      depth = 0;
    }
    if (!open) return;
    inside.add(i);
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        started = true;
      }
      if (ch === "}") depth -= 1;
    }
    if (started && depth === 0) open = false;
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
  const { code, comments } = stripComments(lines, css);
  const skip = css ? themeLines(code) : new Set();
  const violations = [];
  const exceptions = [];
  const errors = [];
  const usedAllows = new Set();

  // Only a comment carries a hatch: help text in a string or JSX must not switch the lint off.
  const allowAt = (i) => {
    const m = i >= 0 ? comments[i].match(ALLOW) : null;
    // Comment text only (stripComments drops the `*/`), so the reason needs no cleanup.
    return m ? { index: i, reason: m[1].trim() } : null;
  };

  code.forEach((line, i) => {
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
