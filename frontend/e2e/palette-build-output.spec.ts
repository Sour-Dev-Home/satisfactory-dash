import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

// The command bar's cmdk is loaded on the first Ctrl+K, not with the app (#387): the entry chunk
// and everything it imports statically carry none of it, and a lazy chunk does.

const ASSETS = join(import.meta.dirname, "..", "dist", "assets");
// Strings only cmdk's own code has (its root and list-sizer attributes), not our class names.
const CMDK_MARKERS = ["cmdk-root", "cmdk-list-sizer"];

const read = (file: string) => readFileSync(join(ASSETS, file), "utf8");
const hasCmdk = (text: string) => CMDK_MARKERS.some((marker) => text.includes(marker));

/** The entry script index.html loads, plus every chunk it imports statically, transitively. */
function initialChunks(): Set<string> {
  const html = readFileSync(join(ASSETS, "..", "index.html"), "utf8");
  const entry = /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
  expect(entry, "index.html has no entry script").toBeTruthy();
  const seen = new Set<string>();
  const queue = [entry as string];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    // Static imports only (`import"./x.js"`, `from"./x.js"`); `import("./x.js")` is a lazy chunk.
    for (const match of read(file).matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g)) {
      queue.push(match[1]);
    }
  }
  return seen;
}

// Runs in the desktop project only (see playwright.config.ts).
test.describe("production build: the command bar's chunk (#387)", () => {
  test("the entry chunk and its static imports contain no cmdk", () => {
    for (const file of initialChunks()) {
      expect(hasCmdk(read(file)), `${file} is loaded up front and contains cmdk`).toBe(false);
    }
  });

  test("a separate, lazily loaded chunk does", () => {
    const initial = initialChunks();
    const lazy = readdirSync(ASSETS).filter((f) => f.endsWith(".js") && !initial.has(f) && hasCmdk(read(f)));
    expect(lazy, "no lazy chunk contains cmdk").toHaveLength(1);
  });
});
