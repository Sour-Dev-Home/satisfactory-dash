import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ContentError,
  loadChangelog,
  loadGuides,
  MIN_GUIDE_WORDS,
  parseChangelog,
  parseDate,
  parseFrontMatter,
  parseGuide,
  renderMarkdown,
  slugFromFile,
  sortGuides,
  type Guide,
} from "./content.ts";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const guideSource = (front: string, body = words(MIN_GUIDE_WORDS)) => `---\n${front}\n---\n\n${body}\n`;
const FRONT = "title: A guide\ndescription: What it covers.\norder: 2\nupdated: 2026-11-03";

describe("parseFrontMatter", () => {
  const keys = ["title", "description", "order", "updated"];

  it("reads key: value lines between --- lines, and the body after", () => {
    const { data, body } = parseFrontMatter("---\ntitle: Hello: world\norder: 3\n---\nBody text\n", "a.md", keys);
    expect(data.get("title")).toBe("Hello: world");
    expect(data.get("order")).toBe("3");
    expect(body.trim()).toBe("Body text");
  });

  it("strips matching quotes, handles CRLF and a BOM", () => {
    const { data } = parseFrontMatter("﻿---\r\ntitle: \"Quoted\"\r\ndescription: 'Single'\r\n---\r\nx", "a.md", keys);
    expect(data.get("title")).toBe("Quoted");
    expect(data.get("description")).toBe("Single");
  });

  it.each([
    ["no opening line", "title: x\n---\nbody", /start with/],
    ["no closing line", "---\ntitle: x\nbody", /closing/],
    ["an unknown key", "---\nauthor: x\n---\n", /unknown front matter key `author`/],
    ["a key twice", "---\ntitle: a\ntitle: b\n---\n", /appears twice/],
    ["a line that isn't key: value", "---\njust text\n---\n", /not `key: value`/],
    ["a prototype key", "---\nconstructor: x\n---\n", /unknown/],
  ])("fails on %s, naming the file", (_, source, message) => {
    expect(() => parseFrontMatter(source, "bad.md", keys)).toThrow(message);
    expect(() => parseFrontMatter(source, "bad.md", keys)).toThrow(/^bad\.md: /);
  });
});

describe("parseDate", () => {
  it("accepts a real YYYY-MM-DD date", () => {
    expect(parseDate("2026-02-28", "a.md")).toBe("2026-02-28");
    expect(parseDate("2028-02-29", "a.md")).toBe("2028-02-29");
  });

  it.each(["2026-02-30", "2026-13-01", "2026-1-5", "03/11/2026", "2026-11-03T00:00", ""])("rejects %j", (value) => {
    expect(() => parseDate(value, "a.md")).toThrow(ContentError);
  });
});

describe("slugFromFile", () => {
  it("is the file name without .md", () => {
    expect(slugFromFile("getting-started.md")).toBe("getting-started");
    expect(slugFromFile("power2.md")).toBe("power2");
  });

  it.each(["Getting-Started.md", "two--hyphens.md", "-lead.md", "trail-.md", "under_score.md", "space here.md", "guide.markdown", ".md"])(
    "rejects %j",
    (name) => expect(() => slugFromFile(name)).toThrow(ContentError),
  );
});

describe("renderMarkdown", () => {
  it("renders Markdown", () => {
    expect(renderMarkdown("## Section\n\nSome *text* and [a link](/guides).", "a.md")).toBe(
      '<h2>Section</h2>\n<p>Some <em>text</em> and <a href="/guides">a link</a>.</p>\n',
    );
  });

  it("never passes raw HTML through: tags come out as text", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nInline <b onclick="x()">bold</b> <img src=x onerror=alert(1)>', "a.md");
    expect(html).not.toMatch(/<script|<b\b|<img/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b onclick=&quot;x()&quot;&gt;bold&lt;/b&gt;");
  });

  it("drops script URLs from links", () => {
    const html = renderMarkdown("[click](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [vb](vbscript:x)", "a.md");
    expect(html).not.toMatch(/href="(javascript|data|vbscript):/i);
  });

  it("fails on an h1 (the title is the page's h1), Setext style too", () => {
    expect(() => renderMarkdown("# Title", "a.md")).toThrow(/no `#` heading/);
    expect(() => renderMarkdown("Title\n=====", "a.md")).toThrow(/no `#` heading/);
  });

  it("fails on a skipped heading level, and allows going back up", () => {
    expect(() => renderMarkdown("### Too deep", "a.md")).toThrow(/skips from h1 to h3/);
    expect(() => renderMarkdown("## A\n\n#### B", "a.md")).toThrow(/skips from h2 to h4/);
    expect(() => renderMarkdown("## A\n\n### B\n\n## C\n\n### D", "a.md")).not.toThrow();
  });

  it("allows only this site's own images", () => {
    expect(renderMarkdown("![Alt](/game-assets/x.png)", "a.md")).toContain('<img src="/game-assets/x.png" alt="Alt">');
    expect(() => renderMarkdown("![Alt](https://example.com/x.png)", "a.md")).toThrow(/this site's own files/);
    expect(() => renderMarkdown("![Alt](//example.com/x.png)", "a.md")).toThrow(/this site's own files/);
    expect(() => renderMarkdown("![Alt](x.png)", "a.md")).toThrow(/this site's own files/);
    // "/\host" reads as "//host" in a browser; markdown-it percent-encodes the backslash, so it stays a path here.
    expect(renderMarkdown("![Alt](/\\example.com/x.png)", "a.md")).toContain('src="/%5Cexample.com/x.png"');
  });

  it("makes code blocks keyboard-focusable, since they scroll sideways on a phone", () => {
    expect(renderMarkdown("```\nnpm ci\n```", "a.md")).toBe('<pre tabindex="0"><code>npm ci\n</code></pre>\n');
    expect(renderMarkdown("    indented", "a.md")).toMatch(/^<pre tabindex="0"><code>indented/);
    expect(renderMarkdown("Inline `code` only", "a.md")).not.toContain("tabindex");
  });
});

describe("parseGuide", () => {
  it("reads the front matter, the slug and the body", () => {
    const guide = parseGuide("a-guide.md", guideSource(FRONT));
    expect(guide).toMatchObject({ slug: "a-guide", title: "A guide", description: "What it covers.", order: 2, updated: "2026-11-03" });
    expect(guide.html).toMatch(/^<p>word0 /);
  });

  it.each([
    ["no title", "description: d\norder: 1\nupdated: 2026-11-03", /`title`/],
    ["an empty description", "title: t\ndescription:\norder: 1\nupdated: 2026-11-03", /`description`/],
    ["no order", "title: t\ndescription: d\nupdated: 2026-11-03", /`order`/],
    ["a fractional order", "title: t\ndescription: d\norder: 1.5\nupdated: 2026-11-03", /whole number/],
    ["a negative order", "title: t\ndescription: d\norder: -1\nupdated: 2026-11-03", /whole number/],
    ["no updated date", "title: t\ndescription: d\norder: 1", /`updated`/],
  ])("fails on %s", (_, front, message) => {
    expect(() => parseGuide("g.md", guideSource(front))).toThrow(message);
  });

  it("fails on a stub shorter than the minimum", () => {
    expect(() => parseGuide("g.md", guideSource(FRONT, words(MIN_GUIDE_WORDS - 1)))).toThrow(/at least/);
  });
});

describe("sortGuides", () => {
  const guide = (slug: string, order: number) => ({ slug, order }) as Guide;

  it("orders by `order`, then by slug, whatever order the files come in", () => {
    const sorted = sortGuides([guide("c", 2), guide("b", 1), guide("a", 2), guide("z", 0)]);
    expect(sorted.map((g) => g.slug)).toEqual(["z", "b", "a", "c"]);
  });

  it("compares order as numbers, not text", () => {
    expect(sortGuides([guide("ten", 10), guide("nine", 9)]).map((g) => g.slug)).toEqual(["nine", "ten"]);
  });
});

describe("parseChangelog", () => {
  it("needs a title, description and date, and no order", () => {
    const changelog = parseChangelog("changelog.md", "---\ntitle: Changelog\ndescription: d\nupdated: 2026-11-03\n---\n## 3 November 2026\n\n- A change");
    expect(changelog.html).toContain("<h2>3 November 2026</h2>");
    expect(() => parseChangelog("changelog.md", "---\ntitle: C\ndescription: d\norder: 1\nupdated: 2026-11-03\n---\n")).toThrow(/unknown/);
  });
});

describe("the content in frontend/content/", () => {
  const root = join(import.meta.dirname, "..", "content");

  it("builds: every guide and the changelog pass every rule", () => {
    const guides = loadGuides(join(root, "guides"));
    expect(guides.length).toBeGreaterThan(0);
    expect(guides.map((g) => g.slug)).toContain("getting-started");
    expect(loadChangelog(join(root, "changelog.md")).title).toBe("Changelog");
  });
});
