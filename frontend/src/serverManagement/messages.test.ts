import { describe, expect, it } from "vitest";
import type { TestConnectionResponse } from "@satisfactory-dash/shared";
import { testConnectionApiUnauthorized, testConnectionFrmUnreachable, testConnectionPassed } from "@satisfactory-dash/shared/fixtures";
import { checkLines } from "./messages";

describe("checkLines", () => {
  it("says OK for a passing check", () => {
    const lines = checkLines(testConnectionPassed);
    expect(lines).toEqual([
      { label: "Game API", ok: true, text: "OK" },
      { label: "FicsitRemoteMonitoring", ok: true, text: "OK" },
    ]);
  });

  it("names a known failure code", () => {
    expect(checkLines(testConnectionApiUnauthorized)[0].text).toBe("rejected the token");
    expect(checkLines(testConnectionFrmUnreachable)[1].text).toMatch(/didn't answer/);
  });

  // #368: `error` is validated against a closed schema enum today, but the lookup reads own
  // keys only, so a code this build has never seen (including an inherited name like
  // "toString") falls back to "failed" instead of rendering a function as the line's text.
  it("falls back to \"failed\" for an error code this build doesn't know", () => {
    const result = {
      ok: false,
      api: { ok: false, error: "toString" },
      frm: { ok: true },
    } as unknown as TestConnectionResponse;
    expect(checkLines(result)[0].text).toBe("failed");
  });
});
