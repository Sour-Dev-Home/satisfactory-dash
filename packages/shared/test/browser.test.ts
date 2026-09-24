import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../src/browser";

// zod is a single shared instance in this test file (Vitest can't reset a dependency from
// node_modules between tests), so everything here asserts the state after `browser` loaded.
describe("@satisfactory-dash/shared/browser", () => {
  it("turns zod's jitless mode on, so the eval probe never runs", () => {
    expect(z.config().jitless).toBe(true);
    // `allowsEval` is where zod would run `new Function("")`; under jitless it answers false
    // without probing, so a strict CSP sees no securitypolicyviolation.
    expect(z.core.util.allowsEval.value).toBe(false);
  });

  it("still validates objects correctly in jitless mode", () => {
    const schema = z.object({ name: z.string(), count: z.number().int(), tags: z.array(z.string()).optional() });
    expect(schema.parse({ name: "a", count: 3 })).toEqual({ name: "a", count: 3 });
    expect(schema.parse({ name: "a", count: 3, tags: ["x"] })).toEqual({ name: "a", count: 3, tags: ["x"] });
    expect(schema.safeParse({ name: "a", count: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ name: 1, count: 3 }).success).toBe(false);
    expect(schema.safeParse({ name: "a" }).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });

  it("is exported from the package as ./browser", async () => {
    const pkg = (await import("../package.json")) as { default: { exports: Record<string, string> } };
    expect(pkg.default.exports["./browser"]).toBe("./src/browser.ts");
  });
});
