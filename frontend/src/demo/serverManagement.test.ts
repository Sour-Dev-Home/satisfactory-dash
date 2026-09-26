import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  endpoints,
  ManagedServerListResponseSchema,
  ServerListResponseSchema,
  TestConnectionResponseSchema,
} from "@satisfactory-dash/shared";
import { resetDemoState } from "./handlers";
import { transport } from "./transport";
import { DEMO_SERVER_ID } from "./world";

// ADR-0030 in the demo: the Servers screens work, the connection test is simulated, nothing is
// saved, and a LAN server is never accepted.

const call = (method: string, path: string, body?: unknown) =>
  transport(path, {
    method,
    credentials: "include",
    ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

const connection = (host: string) => ({ host, apiPort: 7777, frmPort: 8080, apiToken: "typed-in-the-demo" });

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
});

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("server management in the demo", () => {
  it("makes the visitor the operator and lists the demo server", async () => {
    const list = ServerListResponseSchema.parse(await (await call("GET", endpoints.servers.path())).json());
    expect(list.canManageServers).toBe(true);
    const managed = ManagedServerListResponseSchema.parse(
      await (await call("GET", endpoints.serverManagement.list.path())).json(),
    );
    expect(managed.servers.map((s) => s.id)).toEqual([DEMO_SERVER_ID]);
  });

  it("simulates a passing test for a server on this machine", async () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      const res = await call("POST", endpoints.serverManagement.testConnection.path(), connection(host));
      expect(TestConnectionResponseSchema.parse(await res.json()).ok).toBe(true);
    }
    const saved = await call("POST", endpoints.serverManagement.testSaved.path(DEMO_SERVER_ID));
    expect(TestConnectionResponseSchema.parse(await saved.json()).ok).toBe(true);
  });

  it("refuses a LAN server for a test, an add and an edit, like the real backend", async () => {
    const test = await call("POST", endpoints.serverManagement.testConnection.path(), connection("192.168.1.20"));
    expect(test.status).toBe(422);
    expect(await codeOf(test)).toBe("lan_requires_cert_pinning");
    const add = await call("POST", endpoints.serverManagement.create.path(), {
      id: "lan",
      displayName: "LAN",
      ...connection("game.lan"),
    });
    expect(await codeOf(add)).toBe("lan_requires_cert_pinning");
    const edit = await call("PATCH", endpoints.serverManagement.update.path(DEMO_SERVER_ID), { host: "10.0.0.5" });
    expect(await codeOf(edit)).toBe("lan_requires_cert_pinning");
  });

  it("never saves: adding, editing and removing are refused, and the list stays the same", async () => {
    const add = await call("POST", endpoints.serverManagement.create.path(), {
      id: "second",
      displayName: "Second",
      ...connection("127.0.0.1"),
    });
    const edit = await call("PATCH", endpoints.serverManagement.update.path(DEMO_SERVER_ID), { displayName: "New" });
    const remove = await call("DELETE", endpoints.serverManagement.remove.path(DEMO_SERVER_ID));
    for (const res of [add, edit, remove]) {
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe("forbidden");
    }
    const managed = ManagedServerListResponseSchema.parse(
      await (await call("GET", endpoints.serverManagement.list.path())).json(),
    );
    expect(managed.servers).toHaveLength(1);
  });

  // The router's bodyOf() swallows a JSON parse failure to {} rather than crashing, so these
  // never throw; what code they answer with is worth pinning down explicitly.
  describe("a malformed request body", () => {
    const malformed = (method: string, path: string) =>
      transport(path, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: "{not json" });

    it("answers test-connection and create as a LAN refusal, not a validation error", async () => {
      // body.host is undefined once the parse failure falls back to {}, and onThisMachine(undefined)
      // is false: this lands on lan_requires_cert_pinning even though nothing about the host was
      // actually checked. The real backend would answer bad_request for unparsable JSON instead
      // (see settings.setAutoPause below); the demo's create/test-connection routes don't.
      const test = await malformed("POST", endpoints.serverManagement.testConnection.path());
      expect(test.status).toBe(422);
      expect(await codeOf(test)).toBe("lan_requires_cert_pinning");

      const add = await malformed("POST", endpoints.serverManagement.create.path());
      expect(add.status).toBe(422);
      expect(await codeOf(add)).toBe("lan_requires_cert_pinning");
    });

    it("answers update (PATCH) as the demo's blanket refusal instead", async () => {
      // Here body.host undefined takes the "no host change requested" branch, so it reaches
      // NOT_SAVED (403) rather than LAN_REFUSED (422) -- a different fallback than create/test-
      // connection get for the identical malformed input.
      const edit = await malformed("PATCH", endpoints.serverManagement.update.path(DEMO_SERVER_ID));
      expect(edit.status).toBe(403);
      expect(await codeOf(edit)).toBe("forbidden");
    });

    it("still answers bad_request for auto-pause, unlike the server-management routes", async () => {
      const res = await malformed("PUT", endpoints.settings.setAutoPause.path(DEMO_SERVER_ID));
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("bad_request");
    });
  });
});
