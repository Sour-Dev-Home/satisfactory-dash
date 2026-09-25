import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { playersUnavailable } from "@satisfactory-dash/shared/fixtures";

// Regression: OverviewView always queries endpoints.players (players.ts), so every test that
// renders it needs a default mock, or MSW's onUnhandledRequest: "error" (vitest-setup.ts) fires
// on every render/refetch. That error was getting swallowed by the roster query's own tolerant
// error handling (OverviewView reads only `.data`, never `.isError`), so the missing handler
// didn't fail dismissal.test.tsx - it just spammed "[MSW] Error: intercepted a request without a
// matching request handler" and quietly turned every roster fetch there into a network failure.
describe("the default MSW handlers", () => {
  it("answer endpoints.players, so a query for it never hits an unhandled request", async () => {
    const res = await fetch(endpoints.players.path("default"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(playersUnavailable);
  });
});
