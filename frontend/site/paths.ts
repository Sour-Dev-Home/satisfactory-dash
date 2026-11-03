// The public pages the main site's build writes (site/plugin.ts) and the URLs they link to. No imports: the app
// (src/landing/), the Worker (worker/handle.ts), the Vite config and the tests all read it, each under its own tsconfig.

/** The main site's origin, for canonical URLs, the sitemap and link previews. */
export const SITE_ORIGIN = "https://satis-manager.com";
/** The live demo (ADR-0026): its own site, so every page links to it as a plain link. */
export const DEMO_URL = "https://demo.satis-manager.com";

/**
 * The prerendered landing page. The Worker serves it for exactly `/` (worker/handle.ts) and `vite preview` does the
 * same (site/plugin.ts); `/` itself can't be this file, since `index.html` is the SPA's empty shell that
 * `not_found_handling` serves for every app path.
 */
export const LANDING_FILE = "landing.html";
/** The path the assets answer for LANDING_FILE (auto-trailing-slash serves `/file` from `file.html`). */
export const LANDING_ASSET_PATH = "/landing";

/** The public paths of the guides index and the changelog; each guide is `${GUIDES_PATH}/<slug>`. */
export const GUIDES_PATH = "/guides";
export const CHANGELOG_PATH = "/changelog";

/** HTML pages the build writes into dist/: they go through the Worker like every HTML page (security headers, nonce). */
export const GENERATED_PAGES = [LANDING_FILE, "guides.html", "guides", "changelog.html"] as const;
/** Non-HTML files the build writes into dist/: served directly, so wrangler.jsonc's run_worker_first excludes them. */
export const GENERATED_STATIC_FILES = ["robots.txt", "sitemap.xml"] as const;
