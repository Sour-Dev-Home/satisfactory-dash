import { describe, expect, it } from "vitest";
import { parseFrontMatter, renderMarkdown } from "./content.ts";
import { page } from "./pages.ts";

describe("content edge cases", () => {
  it("never emits a script-scheme link, whatever its case, entity encoding or autolink form", () => {
    const html = renderMarkdown(
      [
        "[a](JaVaScRiPt:alert(1))",
        "[b](&#106;avascript:alert(1))",
        "[c](java\tscript:alert(1))",
        "<javascript:alert(1)>",
        "[d](data:text/html;base64,PHNjcmlwdD4=)",
        "[e](vbscript:x)",
      ].join("\n\n"),
      "x.md",
    );
    expect(html).not.toMatch(/href="[^"]*(javascript|vbscript|data):/i);
    expect(html).not.toMatch(/<script/i);
  });

  it("keeps a `---` thematic break in the body out of the front matter", () => {
    const { data, body } = parseFrontMatter("---\ntitle: T\n---\nintro\n\n---\n\nmore", "x.md", ["title"]);
    expect(data.get("title")).toBe("T");
    expect(body).toContain("more");
  });

  it("escapes HTML in a front matter title and description on the page", () => {
    const html = page({ path: "/x", title: '<img src=x onerror=1>"', description: '"><script>1</script>', content: "", section: "/" });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
  });

  it("rejects an image whose address is protocol-relative or absolute", () => {
    expect(() => renderMarkdown("![x](//evil.example/a.png)", "x.md")).toThrow(/images must be/);
    expect(() => renderMarkdown("![x](https://evil.example/a.png)", "x.md")).toThrow(/images must be/);
  });
});
