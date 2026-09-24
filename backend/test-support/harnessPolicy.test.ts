import { describe, it, expect, vi } from "vitest";
import { startOrSkip } from "./harnessPolicy.js";

describe("startOrSkip (the Docker guard)", () => {
  it("returns the started handle and prints nothing when Docker works", async () => {
    const notice = vi.fn();
    await expect(startOrSkip(async () => "container", {}, notice)).resolves.toBe("container");
    expect(notice).not.toHaveBeenCalled();
  });

  it("locally, a missing Docker skips with one loud notice", async () => {
    const notice = vi.fn();
    const result = await startOrSkip(
      async () => {
        throw new Error("Could not find a working container runtime strategy\nmore detail");
      },
      {},
      notice,
    );
    expect(result).toBeNull();
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls[0][0]).toMatch(/DATABASE TESTS SKIPPED/);
    expect(notice.mock.calls[0][0]).not.toContain("more detail");
  });

  it("with CI set, a missing Docker is an ERROR, never a skip", async () => {
    const notice = vi.fn();
    await expect(
      startOrSkip(
        async () => {
          throw new Error("no docker here");
        },
        { CI: "true" },
        notice,
      ),
    ).rejects.toThrow(/CI is set, so the database tests must not be skipped: no docker here/);
    expect(notice).not.toHaveBeenCalled();
  });

  it("with CI set to any non-empty value the guard applies", async () => {
    for (const ci of ["1", "true", "yes"]) {
      await expect(
        startOrSkip(
          async () => {
            throw new Error("x");
          },
          { CI: ci },
          () => {},
        ),
      ).rejects.toThrow();
    }
  });
});
