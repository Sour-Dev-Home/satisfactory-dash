import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorResponseSchema, endpoints, SessionResponseSchema } from "@satisfactory-dash/shared";
import { resetDemoState } from "./handlers";
import { transport } from "./transport";
import { DEMO_SERVER_ID } from "./world";

// ADR-0047 in the demo: nothing is deleted and nobody leaves. Deleting the account is refused (the visitor has no stored
// account), and leaving the demo server is refused as the real backend refuses its owner.

const call = (method: string, path: string) => transport(path, { method, credentials: "include" });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
  await call("POST", endpoints.auth.login.path());
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const envelope = async (res: Response) => ApiErrorResponseSchema.parse(await res.json()).error;

describe("account deletion and leaving in the demo", () => {
  it("refuses to delete the account and stays signed in", async () => {
    const res = await call("DELETE", endpoints.account.remove.path());
    expect(res.status).toBe(403);
    expect((await envelope(res)).code).toBe("forbidden");
    const session = SessionResponseSchema.parse(await (await call("GET", endpoints.auth.session.path())).json());
    expect(session.authenticated).toBe(true);
  });

  it("names no sign-in methods for the visitor, so Settings offers no deletion", async () => {
    const session = SessionResponseSchema.parse(await (await call("GET", endpoints.auth.session.path())).json());
    expect(session.authenticated && session.user.authMethods).toBeFalsy();
  });

  it("refuses the owner's leave with last_owner, and the server stays listed", async () => {
    const res = await call("POST", endpoints.members.leave.path(DEMO_SERVER_ID));
    expect(res.status).toBe(409);
    expect(await envelope(res)).toMatchObject({ code: "would_orphan", reason: "last_owner" });
    const list = (await (await call("GET", endpoints.servers.path())).json()) as { servers: { id: string }[] };
    expect(list.servers.map((s) => s.id)).toContain(DEMO_SERVER_ID);
  });

  it("answers both like every data route when signed out or for another server", async () => {
    expect((await call("POST", endpoints.members.leave.path("someone-else"))).status).toBe(404);
    await call("POST", endpoints.auth.logout.path());
    expect((await call("DELETE", endpoints.account.remove.path())).status).toBe(401);
  });
});
