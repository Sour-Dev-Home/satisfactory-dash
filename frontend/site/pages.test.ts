import { describe, expect, it } from "vitest";
import type { Changelog, Guide } from "./content.ts";
import { changelogPage, escapeHtml, formatDate, guidePage, guidesIndexPage, robotsTxt, sitemap } from "./pages.ts";
import { landingHtml, previewLandingRoute } from "./plugin.ts";

const guide = (slug: string, title: string, updated = "2026-11-03"): Guide => ({
  slug,
  title,
  description: `About ${title}`,
  order: 1,
  updated,
  html: "<h2>Section</h2>\n<p>Body</p>\n",
});
const changelog: Changelog = { title: "Changelog", description: "What changed", updated: "2026-11-04", html: "<h2>Today</h2>\n" };

describe("escapeHtml and formatDate", () => {
  it("escapes text and attribute characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;");
  });

  it("writes dates the legal pages' way, the same everywhere", () => {
    expect(formatDate("2026-11-03")).toBe("3 November 2026");
    expect(formatDate("2027-01-31")).toBe("31 January 2027");
  });
});

describe("a guide page", () => {
  const html = guidePage(guide("power", 'Power <& "circuits"'));

  it("is a script-free page with its title, description, canonical URL and one h1", () => {
    expect(html).not.toMatch(/<script|style=/i);
    expect(html).toContain("<title>Power &#60;&#38; &#34;circuits&#34; · Satis Manager</title>");
    expect(html).toContain('<meta name="description" content="About Power &#60;&#38; &#34;circuits&#34;" />');
    expect(html).toContain('<link rel="canonical" href="https://satis-manager.com/guides/power" />');
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('<link rel="stylesheet" href="/legal.css" />');
  });

  it("has the site nav with Guides current, and the footer links", () => {
    for (const [label, href] of [["Home", "/"], ["Changelog", "/changelog"], ["Demo", "https://demo.satis-manager.com"], ["Sign in", "/app"]]) {
      expect(html).toContain(`<a href="${href}">${label}</a>`);
    }
    expect(html).toContain('<a href="/guides" aria-current="page">Guides</a>');
    expect(html).toContain('<a href="https://github.com/Sour-Dev-Home/satisfactory-dash">Source code (AGPL-3.0)</a>');
    expect(html).toContain('<a href="/privacy">Privacy</a>');
    expect(html).toContain('<a href="/terms">Terms</a>');
    expect(html).toContain('<time datetime="2026-11-03">3 November 2026</time>');
  });
});

describe("the guides index", () => {
  const html = guidesIndexPage([guide("a", "First"), guide("b", "Second")]);

  it("lists every guide in the order given, linked, with its description", () => {
    expect(html.indexOf('href="/guides/a"')).toBeLessThan(html.indexOf('href="/guides/b"'));
    expect(html).toContain("<p>About Second</p>");
    expect(html).toContain('<link rel="canonical" href="https://satis-manager.com/guides" />');
    expect(html).toContain("<h1>Guides</h1>");
  });
});

describe("the changelog page", () => {
  it("has its own canonical URL and Changelog current in the nav", () => {
    const html = changelogPage(changelog);
    expect(html).toContain('<link rel="canonical" href="https://satis-manager.com/changelog" />');
    expect(html).toContain('<a href="/changelog" aria-current="page">Changelog</a>');
    expect(html).toContain("<h2>Today</h2>");
  });
});

describe("sitemap.xml and robots.txt", () => {
  it("lists every public page and never the app", () => {
    const xml = sitemap([guide("a", "A", "2026-10-01"), guide("b", "B", "2026-11-02")], changelog);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace("https://satis-manager.com", ""));
    expect(locs).toEqual(["/", "/guides", "/guides/a", "/guides/b", "/changelog", "/privacy", "/terms"]);
    expect(xml).not.toContain("/app");
    expect(xml).toContain("<loc>https://satis-manager.com/guides</loc><lastmod>2026-11-02</lastmod>");
    expect(xml).toContain("<loc>https://satis-manager.com/changelog</loc><lastmod>2026-11-04</lastmod>");
  });

  it("allows everything, /app included, and names the sitemap", () => {
    const robots = robotsTxt();
    expect(robots).not.toMatch(/Disallow/i);
    expect(robots).toContain("Sitemap: https://satis-manager.com/sitemap.xml");
  });
});

describe("landingHtml", () => {
  const shell = `<html><head>\n    <title>T</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <noscript>\n      <p>Needs JavaScript.</p>\n    </noscript>\n    <script type="module" src="/assets/i.js"></script>\n  </body></html>`;

  it("puts the markup in the root, moves React's leading hints to <head>, adds the canonical URL, drops the notice", () => {
    const html = landingHtml(shell, '<link rel="preload" as="image" href="/p.png"/><div>Landing $& $1</div>');
    expect(html).toContain('<div id="root"><div>Landing $& $1</div></div>');
    expect(html).toMatch(/<link rel="preload" as="image" href="\/p.png"\/>\n {2}<link rel="canonical" href="https:\/\/satis-manager.com\/" \/>\n {2}<\/head>/);
    expect(html).not.toContain("noscript");
    expect(html).toContain('<script type="module" src="/assets/i.js"></script>');
  });

  it("fails rather than ship a page that falls back to the empty shell", () => {
    expect(() => landingHtml(shell.replace('<div id="root"></div>', "<div id=root></div>"), "<div>x</div>")).toThrow(/root/);
    expect(() => landingHtml(shell, '<link rel="preload" href="/p.png"/>')).toThrow(/nothing/);
    expect(() => landingHtml(shell.replace(/<noscript>[\s\S]*<\/noscript>/, ""), "<div>x</div>")).toThrow(/noscript/);
  });
});

describe("previewLandingRoute (vite preview, as the Worker)", () => {
  it("serves / from landing.html, keeping the query", () => {
    expect(previewLandingRoute("/")).toEqual({ rewrite: "/landing.html" });
    expect(previewLandingRoute("/?a=1&b=2")).toEqual({ rewrite: "/landing.html?a=1&b=2" });
  });

  it("redirects the file's own paths to /", () => {
    expect(previewLandingRoute("/landing")).toEqual({ redirect: "/" });
    expect(previewLandingRoute("/landing.html?x")).toEqual({ redirect: "/?x" });
  });

  it("leaves everything else alone", () => {
    for (const url of ["/app", "/guides", "/privacy", "/landing/x", "/assets/i.js"]) expect(previewLandingRoute(url), url).toBeNull();
  });
});
