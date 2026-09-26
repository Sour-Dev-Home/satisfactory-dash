// Fails `npm run lint` on a raw design value in src/ outside the token block of src/index.css
// (rules in design-tokens.mjs). Tests are skipped: they may assert on real values.
//
// ALLOWED_EXCEPTIONS is the number of `design-token-allow:` hatches in src/. It must match, so
// adding one changes this file too and a reviewer sees it.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDesignTokens } from "./design-tokens.mjs";

const ALLOWED_EXCEPTIONS = 0;

const src = fileURLToPath(new URL("../src", import.meta.url));

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== join(src, "test")) yield* sourceFiles(path);
    } else if (/\.(?:tsx?|css)$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) {
      yield path;
    }
  }
}

const failures = [];
const exceptions = [];
for (const path of sourceFiles(src)) {
  const name = relative(join(src, ".."), path).replaceAll("\\", "/");
  const result = checkDesignTokens(name, readFileSync(path, "utf8"));
  for (const v of [...result.violations, ...result.errors]) failures.push(`${name}:${v.line}: ${v.message}`);
  for (const e of result.exceptions) exceptions.push(`${name}:${e.line}: ${e.reason}`);
}

if (failures.length > 0) {
  console.error(
    `Design tokens: ${failures.length} raw value(s). Add a token to the @theme block in src/index.css and use it, ` +
      `or, if it truly can't be a token, add \`design-token-allow: <reason>\` on or above the line.\n\n${failures.join("\n")}`,
  );
  process.exit(1);
}
if (exceptions.length !== ALLOWED_EXCEPTIONS) {
  console.error(
    `Design tokens: ${exceptions.length} design-token-allow exception(s), but ALLOWED_EXCEPTIONS in ` +
      `scripts/check-design-tokens.mjs is ${ALLOWED_EXCEPTIONS}. Update it in the same change.\n\n${exceptions.join("\n")}`,
  );
  process.exit(1);
}
console.log(`Design tokens: no raw values; ${exceptions.length} exception(s).`);
