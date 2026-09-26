import { describe, it, expect } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { scopedEndpoints } from "../test-support/scopedEndpoints.js";

// The IDOR tests are generated from this selector, so a wrong pattern would silently skip routes.
describe("scopedEndpoints (the selector the generated IDOR tests use)", () => {
  const contract = {
    health: { method: "GET", route: "/api/health" },
    list: { method: "GET", route: "/api/servers" },
    sub: { method: "GET", route: "/api/servers/:serverId/status" },
    nested: { inner: { method: "PUT", route: "/api/servers/:serverId/settings/auto-pause" } },
    bare: { remove: { method: "DELETE", route: "/api/servers/:serverId" }, rename: { method: "PATCH", route: "/api/servers/:serverId" } },
    lookalike: { method: "GET", route: "/api/servers/:serverIdentity/x" },
    auth: { login: { method: "POST", route: "/api/auth/login" } },
  };

  it("selects the bare server route and every sub-resource, at any nesting depth", () => {
    expect(scopedEndpoints(contract).map((e) => `${e.method} ${e.route}`).sort()).toEqual([
      "DELETE /api/servers/:serverId",
      "GET /api/servers/:serverId/status",
      "PATCH /api/servers/:serverId",
      "PUT /api/servers/:serverId/settings/auto-pause",
    ]);
  });

  it("does not select the list, unscoped routes or a look-alike parameter", () => {
    const routes = scopedEndpoints(contract).map((e) => e.route);
    expect(routes).not.toContain("/api/servers");
    expect(routes).not.toContain("/api/health");
    expect(routes.some((r) => r.includes("serverIdentity"))).toBe(false);
  });

  it("names each endpoint by its path in the contract", () => {
    expect(scopedEndpoints(contract).find((e) => e.method === "PUT")?.name).toBe("nested.inner");
  });

  it("carries the contract's operatorOnly flag (false when absent)", () => {
    const marked = scopedEndpoints({
      a: { method: "PATCH", route: "/api/servers/:serverId", operatorOnly: true },
      b: { method: "GET", route: "/api/servers/:serverId/status" },
    });
    expect(marked.map((e) => [e.name, e.operatorOnly])).toEqual([["a", true], ["b", false]]);
  });

  it("finds the real contract's server-scoped endpoints", () => {
    expect(scopedEndpoints(endpoints).length).toBeGreaterThanOrEqual(5);
  });
});
