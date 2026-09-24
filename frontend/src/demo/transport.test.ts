import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, SessionResponseSchema, SettingsResponseSchema, StatusResponseSchema } from "@satisfactory-dash/shared";
import { PENDING_MS, resetDemoState } from "./handlers";
import { transport } from "./transport";
import { DEMO_SERVER_ID } from "./world";

// ADR-0026: the demo transport answers in the page and never touches the network.

const call = (method: string, path: string, body?: unknown) =>
  transport(path, {
    method,
    credentials: "include",
    ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

const enter = () => call("POST", endpoints.auth.login.path(), { username: "demo", password: "demo" });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the demo transport", () => {
  it("starts signed out, and data routes answer 401 like the real API", async () => {
    const session = SessionResponseSchema.parse(await (await call("GET", endpoints.auth.session.path())).json());
    expect(session.authenticated).toBe(false);
    const status = await call("GET", endpoints.status.path(DEMO_SERVER_ID));
    expect(status.status).toBe(401);
    expect((await status.json()).error.code).toBe("unauthorized");
  });

  it("signs in with 'Enter demo' and then serves the demo world", async () => {
    await enter();
    const res = await call("GET", endpoints.status.path(DEMO_SERVER_ID));
    expect(res.status).toBe(200);
    expect(StatusResponseSchema.parse(await res.json()).data.sessionName).toBe("Demo World");
  });

  it("answers an unknown server with server_not_found", async () => {
    await enter();
    const res = await call("GET", endpoints.power.path("somewhere-else"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("server_not_found");
  });

  it("answers a path the demo doesn't have with a visible error, never a request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await enter();
    const res = await call("GET", "/api/servers/demo/something-new");
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("The demo has no data for GET /api/servers/demo/something-new.");
    expect(console.error).toHaveBeenCalledWith("[demo] no demo data for GET /api/servers/demo/something-new");
  });

  it("matches the method too: a GET to a PUT-only route has no demo data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await enter();
    const res = await call("GET", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID));
    expect(res.status).toBe(404);
  });

  it("simulates the auto-pause write in memory: pending for a moment, then applied", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await enter();
    const put = await call("PUT", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), { enabled: true });
    expect(SettingsResponseSchema.parse(await put.json()).data).toMatchObject({ autoPause: true, pending: true });

    vi.setSystemTime(Date.now() + PENDING_MS + 1);
    const later = SettingsResponseSchema.parse(await (await call("GET", endpoints.settings.get.path(DEMO_SERVER_ID))).json());
    expect(later.data).toMatchObject({ autoPause: true, pending: false });
  });

  it("forgets everything on a reset (a reload): signed out, auto-pause back off", async () => {
    await enter();
    await call("PUT", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), { enabled: true });
    resetDemoState();
    expect((await call("GET", endpoints.settings.get.path(DEMO_SERVER_ID))).status).toBe(401);
    await enter();
    const settings = SettingsResponseSchema.parse(await (await call("GET", endpoints.settings.get.path(DEMO_SERVER_ID))).json());
    expect(settings.data.autoPause).toBe(false);
  });

  it("signs out on logout", async () => {
    await enter();
    await call("POST", endpoints.auth.logout.path());
    expect((await call("GET", endpoints.status.path(DEMO_SERVER_ID))).status).toBe(401);
  });

  it("honours an aborted request like fetch would", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transport(endpoints.health.path(), { method: "GET", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
