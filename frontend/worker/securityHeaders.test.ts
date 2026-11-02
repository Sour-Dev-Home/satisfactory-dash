import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFF_POLICY, onPolicy, SECURITY_HEADERS, strictScriptSrc, withDirectives } from "./securityHeaders";

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

/** The `/*` rules of a _headers file, in order (the same reading as vite.config.ts' headersFrom). */
function allPathsRules(text: string): [string, string][] {
  const rules: [string, string][] = [];
  let inAllPaths = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#") || !line.trim()) continue;
    if (!/^\s/.test(line)) {
      inAllPaths = line.trim() === "/*";
      continue;
    }
    const match = /^\s+([^:]+):\s*(.+)$/.exec(line);
    if (inAllPaths && match) rules.push([match[1].trim(), match[2].trim()]);
  }
  return rules;
}

const directives = (policy: string) =>
  new Map(policy.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...value] = part.split(/\s+/);
    return [name, value.join(" ")] as const;
  }));

describe("the Worker's security headers", () => {
  it("are exactly public/_headers' /* rules, names, values and order (one policy, no drift)", () => {
    expect(SECURITY_HEADERS.map(([name, value]) => [name, value])).toEqual(allPathsRules(read("../public/_headers")));
  });

  it("public/_headers has one rule block, /*, so the Worker's copy covers every rule", () => {
    const blocks = read("../public/_headers").split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#") && !/^\s/.test(line));
    expect(blocks).toEqual(["/*"]);
  });

  it("send exactly today's CSP while ads are off", () => {
    const csp = allPathsRules(read("../public/_headers")).find(([name]) => name === "Content-Security-Policy")?.[1];
    expect(OFF_POLICY).toBe(csp);
    expect(directives(OFF_POLICY).get("script-src")).toBe("'self'");
  });
});

describe("the ads-on policy (not yet used)", () => {
  const nonce = "AAECAwQFBgcICQoLDA0ODw==";

  it("has Google's documented script-src, word for word, with the nonce filled in (E1)", () => {
    const capture = read("../../docs-vault/raw-sources/adsense-csp-and-cmp-2026-11-01.md");
    const documented = /^script-src (.+);$/m.exec(capture)?.[1];
    expect(documented).toBe("'nonce-{random}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:");
    expect(strictScriptSrc(nonce)).toBe(documented!.replace("{random}", nonce));
    expect(directives(onPolicy(nonce)).get("script-src")).toBe(strictScriptSrc(nonce));
  });

  it("keeps object-src 'none' and base-uri 'none' (E1)", () => {
    const on = directives(onPolicy(nonce));
    expect(on.get("object-src")).toBe("'none'");
    expect(on.get("base-uri")).toBe("'none'");
  });

  it("changes nothing else yet: build step 4 sets the other directives", () => {
    const off = directives(OFF_POLICY);
    const on = directives(onPolicy(nonce));
    off.delete("script-src");
    on.delete("script-src");
    expect(on).toEqual(off);
  });
});

describe("withDirectives", () => {
  it("replaces a directive in place and appends a missing one", () => {
    expect(withDirectives("default-src 'self'; script-src 'self'", [["script-src", "'none'"], ["base-uri", "'none'"]])).toBe(
      "default-src 'self'; script-src 'none'; base-uri 'none'",
    );
  });

  it("matches directive names case-insensitively, as CSP does", () => {
    expect(withDirectives("Script-Src 'self'", [["script-src", "'none'"]])).toBe("Script-Src 'none'");
  });
});
