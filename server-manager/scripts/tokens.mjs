// The dashboard's design tokens for the server manager's window (ADR-0040 decision 7): the custom properties of the
// `@theme` block in frontend/src/index.css, emitted as a plain `:root` rule. One source, so the planned style review
// restyles both together. Nested at-rules inside @theme (its @keyframes) are skipped.

/** Returns `:root { --x: y; ... }` from the first `@theme { ... }` block; throws when there is none or it is empty. */
export function themeToRootCss(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = text.search(/@theme\s*\{/);
  if (start < 0) throw new Error("no @theme block found");
  let i = text.indexOf("{", start) + 1;
  let depth = 1;
  let top = "";
  for (; i < text.length && depth > 0; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 1) top += ch;
  }
  if (depth !== 0) throw new Error("unterminated @theme block");
  const declarations = [];
  for (const m of top.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.push(`  ${m[1]}: ${m[2].trim().replace(/\s+/g, " ")};`);
  }
  if (declarations.length === 0) throw new Error("the @theme block has no custom properties");
  return `/* Generated from frontend/src/index.css by scripts/tokens.mjs. Do not edit. */\n:root {\n${declarations.join("\n")}\n}\n`;
}
