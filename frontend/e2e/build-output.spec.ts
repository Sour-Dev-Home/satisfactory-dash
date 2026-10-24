import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { PREVIEW } from "../src/landing/preview";
import { expect, test } from "./fixtures";

// The production build the other specs run against: check it ships none of the mock tooling
// and is served with the production security headers.

const DIST = join(import.meta.dirname, "..", "dist");

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? allFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// Runs in the desktop project only (see playwright.config.ts).
test.describe("production build", () => {
  test("contains no mock API code, MSW worker or fixture data", () => {
    const files = allFiles(DIST);
    expect(files.some((f) => f.endsWith("mockServiceWorker.js"))).toBe(false);
    const text = files
      .filter((f) => /\.(js|html|css)$/.test(f))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    // Markers of msw's browser runtime, the mock-mode module, the mock-only crash probe and
    // fixture-only values.
    for (const marker of ["setupWorker", "[mock api]", "[crash probe]", "ExampleSession", "example-password"]) {
      expect(text, `production bundle contains ${marker}`).not.toContain(marker);
    }
  });

  test("is served with the production security headers", async ({ request }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    // includeSubDomains (#562): every subdomain serves HTTPS, and status.satis-manager.com's provider issues
    // its certificate. No preload: that list is hard to leave. The demo's headers are these plus its own
    // connect-src (checked below), so HSTS too.
    expect(response.headers()["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  test("contains none of the demo build's code or text (ADR-0026)", () => {
    const text = bundleText(DIST);
    for (const marker of DEMO_MARKERS) {
      expect(text, `production bundle contains demo marker ${marker}`).not.toContain(marker);
    }
  });

  // Link previews don't run JavaScript, so these must be in the served HTML itself.
  test("has static link-preview tags, with an absolute og:image that ships", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    const meta = (key: string) =>
      new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]+)"`).exec(html)?.[1];
    expect(meta("og:title")).toBe("Satis Manager");
    expect(meta("og:description")).toBeTruthy();
    expect(meta("og:image:alt")).toBeTruthy();
    expect(meta("twitter:card")).toBe("summary_large_image");
    const image = new URL(meta("og:image") ?? "");
    expect(image.origin).toBe("https://satis-manager.com");
    expect(meta("og:image:width")).toBe("1200");
    expect(meta("og:image:height")).toBe("630");
    expect(allFiles(DIST)).toContain(join(DIST, image.pathname));
  });

  // The logo's icons (#444, `npm run assets:icons`) and the landing's Overview still (`npm run assets:preview`).
  test("links the favicon, touch icon and manifest, and ships every file they name", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    const link = (rel: string) => new RegExp(`<link\\s+rel="${rel}"[^>]*\\shref="([^"]+)"`).exec(html)?.[1];
    const files = allFiles(DIST);
    for (const rel of ["icon", "apple-touch-icon", "manifest"]) {
      const href = link(rel);
      expect(href, `<link rel="${rel}">`).toMatch(/^\//);
      expect(files).toContain(join(DIST, href!));
    }
    const manifest = JSON.parse(readFileSync(join(DIST, link("manifest")!), "utf8")) as { icons: { src: string }[] };
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const { src } of manifest.icons) expect(files).toContain(join(DIST, src));
    expect(files).toContain(join(DIST, PREVIEW.src));
    // The landing's largest paint: keep it light (the asset script checks the same budget).
    expect(statSync(join(DIST, PREVIEW.src)).size).toBeLessThan(200 * 1024);
  });
});

// ADR-0050 Decision 3: dagre lives in the planner graph's lazy chunk only, and that chunk stays under 100 kB gzip.
const GRAPH_CHUNK_GZIP_BUDGET = 100 * 1024;
/** A string only dagre's source carries (its ranker names); the entry chunk must never hold it. */
const DAGRE_MARKER = "network-simplex";

function checkGraphChunk(dist: string) {
  const assets = join(dist, "assets");
  const scripts = readdirSync(assets).filter((f) => f.endsWith(".js"));
  const withDagre = scripts.filter((f) => readFileSync(join(assets, f), "utf8").includes(DAGRE_MARKER));
  expect(withDagre, "exactly one chunk holds dagre, and it is the graph's").toHaveLength(1);
  expect(withDagre[0]).toMatch(/^SiteGraph-/);
  // The entry chunk is the one index.html loads (and anything it preloads at the start is checked by the marker above).
  const html = readFileSync(join(dist, "index.html"), "utf8");
  expect(html).not.toContain(withDagre[0]);
  const gzipped = gzipSync(readFileSync(join(assets, withDagre[0]))).length;
  expect(gzipped, `graph chunk is ${gzipped} bytes gzip`).toBeLessThan(GRAPH_CHUNK_GZIP_BUDGET);
}

test.describe("the planner graph's chunk", () => {
  test("holds dagre alone and stays under its gzip budget (production build)", () => {
    checkGraphChunk(DIST);
  });
});

// The demo site (ADR-0026), built by e2e/build-demo.mjs with the production API URL set.
const DIST_DEMO = join(import.meta.dirname, "..", "dist-demo");
const API_ORIGIN = "api.satis-manager.com";
const NETWORK_TRANSPORT_MARKER = "satisManagerNetworkTransport";
/** Text only the demo build has. The prod check above fails if any of it leaks there. */
const DEMO_MARKERS = ["Demo data: nothing here is live", "Enter demo", "[demo] no demo data", "Demo World"];
/** Text only the landing page (src/landing/) has; main site only. */
const LANDING_MARKER = "Sign-in is invite-only during the beta.";

function bundleText(dir: string): string {
  return allFiles(dir)
    .filter((f) => /\.(js|html|css)$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

test.describe("demo build", () => {
  test("is the demo: its own text is there (so the other checks aren't vacuous)", () => {
    const text = bundleText(DIST_DEMO);
    for (const marker of DEMO_MARKERS) expect(text, `demo bundle lacks ${marker}`).toContain(marker);
  });

  test("holds dagre in the graph's lazy chunk alone, under its gzip budget", () => {
    checkGraphChunk(DIST_DEMO);
  });

  test("has no landing page: the demo's / is 'Enter demo'", () => {
    expect(bundleText(DIST)).toContain(LANDING_MARKER);
    expect(bundleText(DIST_DEMO)).not.toContain(LANDING_MARKER);
  });

  test("never mentions the real API, though its URL was set for the build: no network transport", () => {
    expect(bundleText(DIST_DEMO)).not.toContain(API_ORIGIN);
  });

  test("holds no network transport, by its marker (present in production, so the check is real)", () => {
    // src/api/transport.ts names its function; this holds however it gets its base URL.
    expect(bundleText(DIST)).toContain(NETWORK_TRANSPORT_MARKER);
    expect(bundleText(DIST_DEMO)).not.toContain(NETWORK_TRANSPORT_MARKER);
  });

  test("doesn't carry the landing page's video (the demo has no landing)", () => {
    expect(allFiles(DIST)).toContain(join(DIST, "demo", "walkthrough.mp4"));
    expect(allFiles(DIST_DEMO).filter((f) => f.endsWith(".mp4"))).toEqual([]);
  });

  test("doesn't carry its own privacy or terms page (it links to the main site's)", () => {
    for (const page of ["privacy.html", "terms.html", "legal.css"]) {
      expect(allFiles(DIST)).toContain(join(DIST, page));
      expect(allFiles(DIST_DEMO)).not.toContain(join(DIST_DEMO, page));
    }
  });

  test("serves the map's resource icons (#571) and their NOTICE in both builds", () => {
    for (const dir of [DIST, DIST_DEMO]) {
      const files = allFiles(dir);
      expect(files).toContain(join(dir, "game-assets", "NOTICE.md"));
      expect(files).toContain(join(dir, "game-assets", "resources", "iron-ore.webp"));
    }
  });

  test("has no service worker and no push UI (ADR-0044)", () => {
    expect(allFiles(DIST)).toContain(join(DIST, "push-sw.js"));
    expect(allFiles(DIST_DEMO)).not.toContain(join(DIST_DEMO, "push-sw.js"));
    const text = bundleText(DIST_DEMO);
    for (const marker of ["push-sw.js", "serviceWorker", "Push notifications on this device"]) {
      expect(text, `demo bundle contains ${marker}`).not.toContain(marker);
    }
  });

  test("ships no mock tooling or test fixtures", () => {
    const files = allFiles(DIST_DEMO);
    expect(files.some((f) => f.endsWith("mockServiceWorker.js"))).toBe(false);
    const text = bundleText(DIST_DEMO);
    for (const marker of ["setupWorker", "[mock api]", "[crash probe]", "ExampleSession", "example-password"]) {
      expect(text, `demo bundle contains ${marker}`).not.toContain(marker);
    }
  });

  test("has its own headers: the production ones, but connect-src 'self' only", () => {
    const demo = readFileSync(join(DIST_DEMO, "_headers"), "utf8");
    const prod = readFileSync(join(DIST, "_headers"), "utf8");
    const csp = (headers: string) => /Content-Security-Policy: (.+)/.exec(headers)![1];
    expect(csp(demo)).toContain("connect-src 'self';");
    expect(csp(demo)).not.toContain(API_ORIGIN);
    // Everything else as strict as production.
    expect(csp(demo)).toBe(csp(prod).replace(/connect-src [^;]+;/, "connect-src 'self';"));
    const rest = (headers: string) =>
      headers
        .split(/\r?\n/)
        .filter((line) => /^\s+\S/.test(line) && !line.includes("Content-Security-Policy"))
        .join("\n");
    expect(rest(demo)).toBe(rest(prod));
  });
});
