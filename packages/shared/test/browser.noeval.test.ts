import { afterEach, describe, expect, it } from "vitest";
import "../src/browser";
import * as schemas from "../src/index";
import * as fixtures from "../fixtures/index";

// Separate file (= separate module state) from browser.test.ts: zod caches its eval probe on
// first use, so this file must not touch `allowsEval` before parsing under the stub.
const RealFunction = globalThis.Function;
afterEach(() => {
  globalThis.Function = RealFunction;
});

describe("@satisfactory-dash/shared/browser: no runtime code compilation", () => {
  it("never constructs a Function while parsing every shared schema against every fixture", () => {
    let constructions = 0;
    globalThis.Function = new Proxy(RealFunction, {
      construct(target, args, newTarget) {
        constructions++;
        return Reflect.construct(target, args, newTarget);
      },
      apply(target, thisArg, args) {
        constructions++;
        return Reflect.apply(target, thisArg, args);
      },
    });
    let parsed = 0;
    for (const [name, schema] of Object.entries(schemas)) {
      if (!name.endsWith("Schema") || typeof (schema as { safeParse?: unknown }).safeParse !== "function") continue;
      for (const fixture of Object.values(fixtures)) {
        (schema as { safeParse: (v: unknown) => unknown }).safeParse(fixture);
        parsed++;
      }
    }
    expect(parsed).toBeGreaterThan(100);
    expect(constructions).toBe(0);
  });

  it("resolves through the package specifier the frontend uses", async () => {
    await expect(import("@satisfactory-dash/shared/browser")).resolves.toBeDefined();
  });
});
