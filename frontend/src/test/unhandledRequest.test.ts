import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "./server";

// vitest-setup.ts starts MSW so that a request with no handler fails the test. MSW 3 renamed
// that option (onUnhandledRequest -> onUnhandledFrame) and silently ignores the old name,
// falling back to "warn", which lets the request through to the network. These pin the rule.
const UNHANDLED = "http://localhost/api/__no-handler-for-this__";

describe("unhandled requests", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects a request that no handler matches, with MSW's error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetch(UNHANDLED)).rejects.toThrow();

    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("without a matching request handler");
    expect(logged).toContain(UNHANDLED);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects an unhandled request of any method, not only GET", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(fetch(UNHANDLED, { method: "POST", body: "{}" })).rejects.toThrow();
  });

  it("still answers a request that a handler matches", async () => {
    server.use(http.get(UNHANDLED, () => HttpResponse.json({ ok: true })));

    const response = await fetch(UNHANDLED);

    expect(await response.json()).toEqual({ ok: true });
  });

  it("rejects again once resetHandlers drops a per-test handler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(http.get(UNHANDLED, () => HttpResponse.json({ ok: true })));
    server.resetHandlers();

    await expect(fetch(UNHANDLED)).rejects.toThrow();
  });
});
