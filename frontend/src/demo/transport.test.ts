import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandResponseSchema,
  endpoints,
  HistoryPowerResponseSchema,
  SessionResponseSchema,
  SetAutoPauseResponseSchema,
  SettingsResponseSchema,
  StatusResponseSchema,
} from "@satisfactory-dash/shared";
import { COMMAND_DELAY_MS, PENDING_MS, resetDemoState } from "./handlers";
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

  it("serves stored power history for the asked range, and a 400 for a bad one (ADR-0027)", async () => {
    await enter();
    const ok = await call("GET", `${endpoints.history.power.path(DEMO_SERVER_ID)}?range=7d`);
    expect(ok.status).toBe(200);
    expect(HistoryPowerResponseSchema.parse(await ok.json()).data.range).toBe("7d");
    const bad = await call("GET", `${endpoints.history.power.path(DEMO_SERVER_ID)}?range=2w`);
    expect(bad.status).toBe(400);
  });

  it("answers a path the demo doesn't have with a visible error, never a request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await enter();
    const res = await call("GET", "/api/servers/demo/something-new");
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("The demo has no data for GET /api/servers/demo/something-new.");
    expect(console.error).toHaveBeenCalledWith("[demo] no demo data for GET /api/servers/demo/something-new");
  });

  it("answers a malformed %-escape with the demo's 404, not a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await enter();
    const res = await call("GET", "/api/servers/%E0%A4%A/status");
    expect(res.status).toBe(404);
  });

  it("matches the method too: a GET to a PUT-only route has no demo data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await enter();
    const res = await call("GET", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID));
    expect(res.status).toBe(404);
  });

  it("simulates the auto-pause write in memory like the backend: 202 with a command, pending, then applied", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await enter();
    const put = await call("PUT", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), { enabled: true });
    expect(put.status).toBe(202);
    const { command } = SetAutoPauseResponseSchema.parse(await put.json());
    expect(command).toMatchObject({ id: "demo-command-1", type: "set_auto_pause", status: "pending", completedAt: null, resultCode: null });
    // The page gives up at expiresAt by its own clock: the expiry is ahead of Date.now(), whatever demoNow() says.
    expect(Date.parse(command.expiresAt)).toBe(Date.now() + 60_000);

    const read = async () =>
      CommandResponseSchema.parse(await (await call("GET", endpoints.commands.get.path(DEMO_SERVER_ID, command.id))).json()).command;
    // The setting reads as the value being applied, pending, while the command waits.
    const during = SettingsResponseSchema.parse(await (await call("GET", endpoints.settings.get.path(DEMO_SERVER_ID))).json());
    expect(during.data).toMatchObject({ autoPause: true, pending: true });
    vi.advanceTimersByTime(COMMAND_DELAY_MS - 1);
    expect((await read()).status).toBe("pending");
    vi.advanceTimersByTime(1);
    expect(await read()).toMatchObject({ status: "succeeded", completedAt: new Date(Date.now()).toISOString() });

    vi.advanceTimersByTime(PENDING_MS);
    const later = SettingsResponseSchema.parse(await (await call("GET", endpoints.settings.get.path(DEMO_SERVER_ID))).json());
    expect(later.data).toMatchObject({ autoPause: true, pending: false });
  });

  it("answers an unknown command id with command_not_found, and a second change with a new command", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await enter();
    const unknown = await call("GET", endpoints.commands.get.path(DEMO_SERVER_ID, "nope"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "command_not_found" } });
    const first = SetAutoPauseResponseSchema.parse(await (await call("PUT", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), { enabled: true })).json());
    const second = SetAutoPauseResponseSchema.parse(await (await call("PUT", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), { enabled: false })).json());
    expect(second.command.id).not.toBe(first.command.id);
    expect((await call("GET", endpoints.commands.get.path(DEMO_SERVER_ID, first.command.id))).status).toBe(200);
  });

  it("forgets its commands on a reset, and a reset stops a command's pending timer", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await enter();
    const { command } = SetAutoPauseResponseSchema.parse(await (await call("PUT", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), { enabled: true })).json());
    resetDemoState();
    expect(vi.getTimerCount()).toBe(0);
    await enter();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("GET", endpoints.commands.get.path(DEMO_SERVER_ID, command.id))).status).toBe(404);
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

  it("answers a PUT body that isn't valid JSON with a 400 bad_request, like the real API", async () => {
    // test-hunter: it used to throw out of the handler and surface as BackendUnreachableError.
    const res = await transport(endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("honours an aborted request like fetch would", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transport(endpoints.health.path(), { method: "GET", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
