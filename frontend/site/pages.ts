// The static public pages' HTML (ADR-0021: /guides/* and /changelog outside the SPA), the sitemap and robots.txt.
// Script-free like public/privacy.html: one same-origin stylesheet (public/legal.css), no inline style or script, so
// the strict CSP needs nothing new. Every text from the content files is escaped here; bodies come from content.ts
// (markdown-it with raw HTML off).
import { REPO_URL } from "../src/source.ts";
import type { Changelog, Guide } from "./content.ts";
import { CHANGELOG_PATH, DEMO_URL, GUIDES_PATH, SITE_ORIGIN } from "./paths.ts";

const SITE_NAME = "Satis Manager";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "2026-11-03" as "3 November 2026", the legal pages' style, the same on every machine. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS.at(month - 1)} ${year}`;
}

const NAV: readonly { label: string; href: string }[] = [
  { label: "Home", href: "/" },
  { label: "Guides", href: GUIDES_PATH },
  { label: "Changelog", href: CHANGELOG_PATH },
  { label: "Demo", href: DEMO_URL },
  { label: "Sign in", href: "/app" },
];

interface PageInput {
  /** The public path, e.g. /guides/getting-started: the canonical URL and the nav's current page. */
  path: string;
  title: string;
  description: string;
  /** The <main> content after the h1, already HTML. */
  content: string;
  /** Which nav entry is current, by its href (a guide marks Guides). */
  section: string;
}

function updated(date: string): string {
  return `<p class="updated">Last updated: <time datetime="${date}">${formatDate(date)}</time></p>`;
}

export function page({ path, title, description, content, section }: PageInput): string {
  const canonical = `${SITE_ORIGIN}${path}`;
  const nav = NAV.map(
    ({ label, href }) => `<li><a href="${href}"${href === section ? ' aria-current="page"' : ""}>${label}</a></li>`,
  ).join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} · ${SITE_NAME}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/legal.css" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
  </head>
  <body>
    <header>
      <a href="/">${SITE_NAME}</a>
      <nav aria-label="Site"><ul class="site-nav">${nav}</ul></nav>
    </header>
    <main>
      <h1>${escapeHtml(title)}</h1>
${content}
    </main>
    <footer>
      <a href="${GUIDES_PATH}">Guides</a>
      <a href="${CHANGELOG_PATH}">Changelog</a>
      <a href="${REPO_URL}">Source code (AGPL-3.0)</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </footer>
  </body>
</html>
`;
}

export function guidePage(guide: Guide): string {
  return page({
    path: `${GUIDES_PATH}/${guide.slug}`,
    title: guide.title,
    description: guide.description,
    section: GUIDES_PATH,
    content: `${updated(guide.updated)}
<div class="prose">
${guide.html}</div>
<p class="back"><a href="${GUIDES_PATH}">All guides</a></p>`,
  });
}

export const GUIDES_INDEX_DESCRIPTION =
  "Guides to Satis Manager, a live dashboard for a Satisfactory dedicated server: setting it up and reading each page.";

export function guidesIndexPage(guides: Guide[]): string {
  const items = guides
    .map(
      (guide) => `<li>
<h2><a href="${GUIDES_PATH}/${guide.slug}">${escapeHtml(guide.title)}</a></h2>
<p>${escapeHtml(guide.description)}</p>
<p class="updated">Updated <time datetime="${guide.updated}">${formatDate(guide.updated)}</time></p>
</li>`,
    )
    .join("\n");
  return page({
    path: GUIDES_PATH,
    title: "Guides",
    description: GUIDES_INDEX_DESCRIPTION,
    section: GUIDES_PATH,
    content: `<p class="lede">
Satis Manager shows a Satisfactory dedicated server's power, production and machine health in the browser. These
guides cover setting it up and reading what each page shows. To look around first, open the
<a href="${DEMO_URL}">live demo</a>: it runs on a made-up factory and needs no sign-in.
</p>
<ul class="guide-list">
${items}
</ul>`,
  });
}

export function changelogPage(changelog: Changelog): string {
  return page({
    path: CHANGELOG_PATH,
    title: changelog.title,
    description: changelog.description,
    section: CHANGELOG_PATH,
    content: `${updated(changelog.updated)}
<div class="prose">
${changelog.html}</div>`,
  });
}

/** The latest of some YYYY-MM-DD dates (they sort as text). */
function latest(dates: string[]): string {
  return [...dates].sort().at(-1) ?? "";
}

/** Every public page; `/app` is left out on purpose (it's the signed-in app, not content). */
export function sitemap(guides: Guide[], changelog: Changelog): string {
  const entries: [string, string?][] = [
    ["/"],
    [GUIDES_PATH, latest(guides.map((guide) => guide.updated))],
    ...guides.map((guide): [string, string] => [`${GUIDES_PATH}/${guide.slug}`, guide.updated]),
    [CHANGELOG_PATH, changelog.updated],
    ["/privacy"],
    ["/terms"],
  ];
  const urls = entries
    .map(([path, lastmod]) => `  <url><loc>${SITE_ORIGIN}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/** Everything may be crawled, `/app` included: the AdSense crawler's sign-in (ADR-0021 amendment 2) needs it. */
export function robotsTxt(): string {
  return `User-agent: *
Allow: /

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
}
