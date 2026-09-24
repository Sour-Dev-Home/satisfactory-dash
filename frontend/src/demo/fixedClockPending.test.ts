import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, SettingsResponseSchema } from "@satisfactory-dash/shared";
import { DEMO_EPOCH, DEMO_SERVER_ID } from "./world";

// ADR-0026 `?clock=fixed` pins demoNow() so screenshots are identical run to run. handlers.ts's
// settingsNow(), though, gates "pending" on Date.now() (real wall time), not demoNow(). This
// documents what that split actually produces under a frozen clock.
vi.mock("./clock", () => ({ demoNow: () => DEMO_EPOCH }));

const call = (method: string, path: string, body?: unknown) =>
  // Import after the mock is set up.
  import("./transport").then(({ transport }) =>
    transport(path, {
      method,
      credentials: "include",
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }),
  );

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  const { resetDemoState } = await import("./handlers");
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("settingsNow under a frozen demoNow (?clock=fixed)", () => {
  it("resolves 'pending' by real time even though observedAt never advances", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await call("POST", endpoints.auth.login.path(), { username: "demo", password: "demo" });

    const put = await call("PUT", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), { enabled: true });
    const putBody = SettingsResponseSchema.parse(await put.json());
    expect(putBody.data.pending).toBe(true);
    expect(putBody.observedAt).toBe(new Date(DEMO_EPOCH).toISOString());

    // Advance real (faked) wall-clock time well past PENDING_MS, but demoNow() is pinned.
    vi.advanceTimersByTime(10_000);

    const later = await call("GET", endpoints.settings.get.path(DEMO_SERVER_ID));
    const laterBody = SettingsResponseSchema.parse(await later.json());
    // The write "finished" (matches a real server's timing)...
    expect(laterBody.data.pending).toBe(false);
    // ...yet the response timestamp claims nothing has moved since the frozen epoch. A
    // consumer trusting observedAt to mean "when this was true" is misled under fixed clock.
    expect(laterBody.observedAt).toBe(new Date(DEMO_EPOCH).toISOString());
  });
});
