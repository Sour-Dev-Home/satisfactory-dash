import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, ManagedServerListResponseSchema, ServerListResponseSchema } from "@satisfactory-dash/shared";
import { resetDemoState } from "./handlers";
import { transport } from "./transport";
import { DEMO_SERVER_ID } from "./world";

// ADR-0030 in the demo, after ADR-0066: the Servers screen lists the demo server as one the mod connects, its rename
// and remove are refused (nothing is saved), and no stored connection or connection test is served any more.

const call = (method: string, path: string, body?: unknown) =>
  transport(path, {
    method,
    credentials: "include",
    ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
  await call("POST", endpoints.auth.login.path(), { username: "demo", password: "demo" });
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const managed = async () =>
  ManagedServerListResponseSchema.parse(await (await call("GET", endpoints.serverManagement.list.path())).json());

describe("server management in the demo", () => {
  it("makes the visitor the operator and lists the demo server as an agent server, with no stored connection", async () => {
    const list = ServerListResponseSchema.parse(await (await call("GET", endpoints.servers.path())).json());
    expect(list.canManageServers).toBe(true);
    const answer = await managed();
    expect(answer.servers).toEqual([]);
    expect(answer.agentServers?.map((s) => [s.id, s.kind])).toEqual([[DEMO_SERVER_ID, "agent"]]);
  });

  it("never saves: renaming and removing are refused, and the list stays the same", async () => {
    const rename = await call("PATCH", endpoints.serverManagement.renameAgent.path(DEMO_SERVER_ID), { displayName: "New" });
    const remove = await call("DELETE", endpoints.serverManagement.remove.path(DEMO_SERVER_ID));
    for (const res of [rename, remove]) {
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe("forbidden");
    }
    expect((await managed()).agentServers).toHaveLength(1);
  });

  it("serves none of the direct-poll routes ADR-0066 retires: each is the demo's own 404", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const connection = { host: "127.0.0.1", apiPort: 7777, frmPort: 8080, apiToken: "typed-in-the-demo" };
    const retired = [
      call("POST", endpoints.serverManagement.testConnection.path(), connection),
      call("POST", endpoints.serverManagement.testSaved.path(DEMO_SERVER_ID)),
      call("POST", endpoints.serverManagement.create.path(), { id: "second", displayName: "Second", ...connection }),
      call("PATCH", endpoints.serverManagement.update.path(DEMO_SERVER_ID), { displayName: "New" }),
      call("GET", endpoints.serverManagement.get.path(DEMO_SERVER_ID)),
      call("POST", endpoints.serverManagement.switchToLocal.path(DEMO_SERVER_ID), connection),
    ];
    for (const res of await Promise.all(retired)) {
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  it("still answers bad_request for a malformed auto-pause body", async () => {
    const res = await transport(endpoints.settings.setAutoPause.path(DEMO_SERVER_ID), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("bad_request");
  });
});
