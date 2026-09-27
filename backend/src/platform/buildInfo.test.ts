import { describe, it, expect } from "vitest";
import { resolveBuildCommit, buildCommit } from "./buildInfo.js";

describe("resolveBuildCommit (the fallback logic, unit-testable without an esbuild-defined global)", () => {
  it('falls back to "unknown" when nothing was baked in', () => {
    expect(resolveBuildCommit(undefined)).toBe("unknown");
  });

  it('falls back to "unknown" for an empty string too', () => {
    expect(resolveBuildCommit("")).toBe("unknown");
  });

  it("uses the given commit when one was baked in", () => {
    expect(resolveBuildCommit("abc1234")).toBe("abc1234");
  });
});

describe("buildCommit", () => {
  it('is "unknown" outside an esbuild bundle (BUILD_COMMIT is never defined under vitest)', () => {
    expect(buildCommit).toBe("unknown");
  });
});
