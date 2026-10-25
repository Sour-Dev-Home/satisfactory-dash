import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, PairingApproveResponseSchema, PairingLookupResponseSchema } from "@satisfactory-dash/shared";
import { resetDemoState } from "./handlers";
import { DEMO_PAIR_CODE } from "./pairCode";
import { transport } from "./transport";
import { DEMO_SERVER_ID } from "./world";

// ADR-0051 section 1 in the demo: one made-up code pairs with the made-up factory; any other code is the real API's 404.

const post = (path: string, body: unknown) =>
  transport(path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const signIn = () => transport(endpoints.auth.login.path(), { method: "POST", credentials: "include" });

describe("pairing in the demo", () => {
  it("is a valid-shaped code", () => {
    expect(endpoints.pairings.lookup.request.safeParse({ userCode: DEMO_PAIR_CODE }).success).toBe(true);
  });

  it("looks up the demo code and approves it for the demo server", async () => {
    await signIn();
    const found = await post(endpoints.pairings.lookup.path(), { userCode: DEMO_PAIR_CODE });
    expect(found.status).toBe(200);
    PairingLookupResponseSchema.parse(await found.json());
    const done = await post(endpoints.pairings.approve.path(), { userCode: DEMO_PAIR_CODE, target: { kind: "new" } });
    expect(PairingApproveResponseSchema.parse(await done.json()).serverId).toBe(DEMO_SERVER_ID);
  });

  it("answers any other code, and another server's id, with 404", async () => {
    await signIn();
    expect((await post(endpoints.pairings.lookup.path(), { userCode: "AB3D-7XQ2-K5MN" })).status).toBe(404);
    const other = await post(endpoints.pairings.approve.path(), { userCode: DEMO_PAIR_CODE, target: { kind: "existing", serverId: "other" } });
    expect(other.status).toBe(404);
  });

  it("needs a session", async () => {
    expect((await post(endpoints.pairings.lookup.path(), { userCode: DEMO_PAIR_CODE })).status).toBe(401);
  });
});
