import { describe, expect, it } from "vitest";
import mainSource from "./main.tsx?raw";

// zod probes `new Function("")` when a schema (z.object) is built, as modules load, so jitless
// mode only helps if it is on before any other module runs. Import order in main.tsx is the
// whole guarantee.
describe("main.tsx", () => {
  it("imports @satisfactory-dash/shared/browser before anything else", () => {
    const specifiers = [...mainSource.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(
      (m) => m[1],
    );
    expect(specifiers[0]).toBe("@satisfactory-dash/shared/browser");
  });

  // The regex above only sees `import` at the start of a line, so it misses an
  // `export ... from` re-export (evaluated in source order like an import) and is fooled by an
  // import line inside a /* block comment */. Pin down that only // comments come first.
  it("has only // comments and blank lines before that import", () => {
    const at = mainSource.search(/^import\s+['"]@satisfactory-dash\/shared\/browser['"]/m);
    expect(at).toBeGreaterThanOrEqual(0);
    const before = mainSource.slice(0, at).split(/\r?\n/);
    expect(before.filter((line) => line.trim() !== "" && !line.trim().startsWith("//"))).toEqual([]);
  });
});
