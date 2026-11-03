// The main site's public pages, made at build time (the AdSense rejection of 2026-11-03, ADR-0021): a crawler without
// JavaScript must find real text at /, /guides/* and /changelog.
// - Guides and changelog: content/*.md through content.ts and pages.ts, emitted into the bundle as static files.
// - The landing page: after the client build is written, src/landing/prerender.tsx is loaded through a Vite server in
//   middleware mode (no port is opened) and its HTML is put into dist/index.html's root, written as dist/landing.html.
//   The client then hydrates it (src/main.tsx). index.html stays the empty shell every app path is served from.
// The demo build uses neither (its / is "Enter demo"); vite.config.ts adds these plugins outside demo mode only.
// File names give slash-free URLs (`x.html` is served at `/x`): docs-vault/raw-sources/cloudflare-workers-html-handling-2026-11-03.md HH-E2.
import { readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { createServer, type Plugin } from "vite";
import { loadChangelog, loadGuides } from "./content.ts";
import { changelogPage, guidePage, guidesIndexPage, robotsTxt, sitemap } from "./pages.ts";
import { GUIDES_PATH, LANDING_ASSET_PATH, LANDING_FILE, SITE_ORIGIN } from "./paths.ts";

const ROOT_ELEMENT = '<div id="root"></div>';
/** index.html's no-JavaScript notice: on the landing page it would be untrue (the page works without it). */
const NOSCRIPT = /\s*<noscript>[\s\S]*?<\/noscript>/;

/** The resource hints React's renderToString puts ahead of the markup (the hero still's `fetchPriority="high"` preload). */
const LEADING_LINKS = /^(?:<link\b[^>]*>)+/;

/**
 * The landing page's HTML: the shell with `markup` in its root, a canonical link, and no "needs JavaScript" notice.
 * React's leading resource hints move to <head>, where they belong and where hydration (which starts at #root) never
 * meets them. Fails rather than writing a page that would silently fall back to the empty shell.
 */
export function landingHtml(shell: string, markup: string): string {
  if (!shell.includes(ROOT_ELEMENT)) throw new Error(`index.html has no ${ROOT_ELEMENT} to prerender the landing page into`);
  if (!NOSCRIPT.test(shell)) throw new Error("index.html's <noscript> notice is gone: update site/plugin.ts");
  const hints = LEADING_LINKS.exec(markup)?.[0] ?? "";
  const body = markup.slice(hints.length);
  if (!body.trim()) throw new Error("the landing page prerendered to nothing");
  const head = `${hints ? `  ${hints}\n` : ""}  <link rel="canonical" href="${SITE_ORIGIN}/" />\n  </head>`;
  return shell
    .replace(ROOT_ELEMENT, () => `<div id="root">${body}</div>`)
    .replace(NOSCRIPT, "")
    .replace("</head>", () => head);
}

/** Guides, the guides index, the changelog, the sitemap and robots.txt, plus the prerendered landing page. */
export function staticPagesBuild(frontendRoot: string): Plugin {
  let outDir = "";
  let mode = "";
  return {
    name: "static-public-pages",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      mode = config.mode;
    },
    generateBundle() {
      const content = join(frontendRoot, "content");
      const guides = loadGuides(join(content, "guides"));
      const changelog = loadChangelog(join(content, "changelog.md"));
      const emit = (fileName: string, source: string) => this.emitFile({ type: "asset", fileName, source });
      for (const guide of guides) emit(`${GUIDES_PATH.slice(1)}/${guide.slug}.html`, guidePage(guide));
      emit(`${GUIDES_PATH.slice(1)}.html`, guidesIndexPage(guides));
      emit("changelog.html", changelogPage(changelog));
      emit("sitemap.xml", sitemap(guides, changelog));
      emit("robots.txt", robotsTxt());
    },
    writeBundle: {
      sequential: true,
      order: "post",
      async handler() {
        const outRoot = outDir;
        const server = await createServer({
          configFile: join(frontendRoot, "vite.config.ts"),
          root: frontendRoot,
          mode,
          logLevel: "warn",
          appType: "custom",
          server: { middlewareMode: true, hmr: false, ws: false, watch: null },
          optimizeDeps: { noDiscovery: true, include: [] },
        });
        try {
          const { renderLanding } = (await server.ssrLoadModule("/src/landing/prerender.tsx")) as { renderLanding: () => string };
          const shell = readFileSync(join(outRoot, "index.html"), "utf8");
          writeFileSync(join(outRoot, LANDING_FILE), landingHtml(shell, renderLanding()));
        } finally {
          await server.close();
        }
      },
    },
  };
}

/** Where `vite preview` sends a request for the landing page, as the Worker does (worker/handle.ts). */
export function previewLandingRoute(url: string): { rewrite: string } | { redirect: string } | null {
  const [path, query = ""] = url.split(/\?(.*)/s);
  const search = query ? `?${query}` : "";
  if (path === "/") return { rewrite: `/${LANDING_FILE}${search}` };
  if (path === LANDING_ASSET_PATH || path === `/${LANDING_FILE}`) return { redirect: `/${search}` };
  return null;
}

/** `vite preview` (e2e) serves `/` from the prerendered landing page, like production's Worker. */
export function staticPagesPreview(): Plugin {
  return {
    name: "static-public-pages-preview",
    configurePreviewServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const route = previewLandingRoute(req.url ?? "/");
        if (route && "redirect" in route) {
          res.statusCode = 301;
          res.setHeader("Location", route.redirect);
          res.end();
          return;
        }
        if (route) req.url = route.rewrite;
        next();
      });
    },
  };
}
