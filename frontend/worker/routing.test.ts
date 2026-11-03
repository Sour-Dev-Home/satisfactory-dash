// Which requests reach the Worker (wrangler.jsonc's run_worker_first, E1, E2): every HTML page does, no static file
// does. A new file in public/ fails here until it is listed, so it is never served through the Worker by accident.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATED_PAGES, GENERATED_STATIC_FILES } from "../site/paths";

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

/** wrangler.jsonc without its whole-line comments (it has no others). */
function jsonc(path: string): unknown {
  return JSON.parse(read(path).split(/\r?\n/).filter((line) => !/^\s*\/\//.test(line)).join("\n"));
}

interface Config {
  main?: string;
  vars?: { ADS_ENABLED?: string };
  assets: { binding?: string; not_found_handling?: string; run_worker_first?: string[] };
}

const config = jsonc("../wrangler.jsonc") as Config;
const patterns = config.assets.run_worker_first ?? [];
const negatives = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
const publicEntries = readdirSync(join(import.meta.dirname, "../public"), { withFileTypes: true });

describe("the main site's wrangler.jsonc", () => {
  it("runs worker/index.ts with the assets bound as ASSETS, ads off", () => {
    expect(config.main).toBe("./worker/index.ts");
    expect(existsSync(join(import.meta.dirname, "index.ts"))).toBe(true);
    expect(config.assets.binding).toBe("ASSETS");
    expect(config.vars?.ADS_ENABLED).toBe("false");
    expect(config.assets.not_found_handling).toBe("single-page-application");
  });

  it("runs the Worker first for every path not excluded, the root included", () => {
    // Wrangler rejects "/" next to "/*" as redundant, so "/*" covers the root.
    expect(patterns.filter((p) => !p.startsWith("!"))).toEqual(["/*"]);
    expect(patterns.length).toBeLessThanOrEqual(100);
  });

  it("serves Vite's hashed files directly", () => {
    expect(negatives).toContain("/assets/*");
  });

  it("serves every static file in public/ directly, so _headers applies to it", () => {
    for (const entry of publicEntries) {
      if (entry.name === "_headers" || entry.name.endsWith(".html")) continue;
      const pattern = entry.isDirectory() ? `/${entry.name}/*` : `/${entry.name}`;
      expect(negatives, `public/${entry.name} is not in run_worker_first's exclusions`).toContain(pattern);
    }
  });

  it("serves the build's own non-HTML files directly (robots.txt, sitemap.xml)", () => {
    for (const file of GENERATED_STATIC_FILES) expect(negatives, `${file} is not in run_worker_first's exclusions`).toContain(`/${file}`);
  });

  it("runs the Worker for the build's HTML pages: the landing page, the guides and the changelog", () => {
    const pages = GENERATED_PAGES.map((name) => `/${name.replace(/\.html$/, "")}`);
    expect(pages).toEqual(["/landing", "/guides", "/guides", "/changelog"]);
    for (const page of [...pages, "/guides/getting-started"]) {
      const excludedBy = negatives.filter((pattern) => (pattern.endsWith("/*") ? page.startsWith(pattern.slice(0, -1)) : page === pattern));
      expect(excludedBy, `${page} would skip the Worker`).toEqual([]);
    }
  });

  it("never excludes an HTML page, and every exclusion names something that ships", () => {
    const shipped = new Set(publicEntries.map((entry) => (entry.isDirectory() ? `/${entry.name}/*` : `/${entry.name}`)));
    shipped.add("/assets/*");
    for (const file of GENERATED_STATIC_FILES) shipped.add(`/${file}`);
    for (const pattern of negatives) {
      expect(pattern).not.toMatch(/\.html$|^\/\*$|^\/$/);
      expect(shipped, `${pattern} names nothing in public/ or the build`).toContain(pattern);
    }
    // The HTML pages the Worker must see.
    expect(publicEntries.filter((e) => e.name.endsWith(".html")).map((e) => e.name).sort()).toEqual(["privacy.html", "terms.html"]);
  });
});

describe("the demo site's wrangler.jsonc (out of scope, Decision 6)", () => {
  it("has no Worker and keeps its static _headers", () => {
    const demo = jsonc("../demo/wrangler.jsonc") as Config;
    expect(demo.main).toBeUndefined();
    expect(demo.assets.run_worker_first).toBeUndefined();
    expect(demo.vars).toBeUndefined();
  });
});
