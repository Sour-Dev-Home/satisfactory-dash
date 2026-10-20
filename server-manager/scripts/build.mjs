// Builds the server manager into dist/: main and preload as CommonJS for Electron, the renderer as one browser
// script, the page and its styles, and tokens.css generated from the dashboard's @theme block.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { themeToRootCss } from "./tokens.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = `${root}dist`;
const renderer = `${dist}/renderer`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(renderer, { recursive: true });

const node = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "warning" };
await build({ ...node, entryPoints: [`${root}src/main.ts`], outfile: `${dist}/main.cjs` });
await build({ ...node, entryPoints: [`${root}src/preload.ts`], outfile: `${dist}/preload.cjs` });
await build({
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome130",
  entryPoints: [`${root}src/renderer/renderer.ts`],
  outfile: `${renderer}/renderer.js`,
  logLevel: "warning",
});

copyFileSync(`${root}src/renderer/index.html`, `${renderer}/index.html`);
copyFileSync(`${root}src/renderer/styles.css`, `${renderer}/styles.css`);
writeFileSync(`${renderer}/tokens.css`, themeToRootCss(readFileSync(`${root}../frontend/src/index.css`, "utf8")));
