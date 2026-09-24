import { describe, expect, it } from "vitest";
import mainSource from "./main.tsx?raw";

// zod caches its `new Function("")` probe on the first parse, so jitless mode only helps if
// it is on before any other module runs. Import order in main.tsx is the whole guarantee.
describe("main.tsx", () => {
  it("imports @satisfactory-dash/shared/browser before anything else", () => {
    const specifiers = [...mainSource.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(
      (m) => m[1],
    );
    expect(specifiers[0]).toBe("@satisfactory-dash/shared/browser");
  });
});
