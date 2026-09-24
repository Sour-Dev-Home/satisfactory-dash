import { describe, expect, it } from "vitest";
import { get, post, resolve } from "./router";

// Fresh-eyes coverage for the router's edge cases (ADR-0026 PR 2 test-hunter pass): trailing
// slashes, query strings, encoded segments, empty params, method matching and ordering.

const ok = (body: string) => new Response(body);
const req = (method: string, path: string) => new Request(new URL(path, "https://demo.example"), { method });

describe("the demo router", () => {
  it("matches an exact path", async () => {
    const handlers = [get("/api/servers/:serverId/status", () => ok("status"))];
    const res = await resolve(handlers, req("GET", "/api/servers/demo/status"));
    expect(await res?.text()).toBe("status");
  });

  it("does not match a path with a trailing slash the pattern doesn't have", async () => {
    const handlers = [get("/api/servers/:serverId/status", () => ok("status"))];
    const res = await resolve(handlers, req("GET", "/api/servers/demo/status/"));
    expect(res).toBeUndefined();
  });

  it("ignores the query string", async () => {
    const handlers = [get("/api/servers/:serverId/status", ({ params }) => ok(params.serverId))];
    const res = await resolve(handlers, req("GET", "/api/servers/demo/status?verbose=1&x=2"));
    expect(await res?.text()).toBe("demo");
  });

  it("URL-decodes a param segment", async () => {
    const handlers = [get("/api/servers/:serverId/status", ({ params }) => ok(params.serverId))];
    const res = await resolve(handlers, req("GET", "/api/servers/my%20server/status"));
    expect(await res?.text()).toBe("my server");
  });

  it("treats an empty param segment as no match, not an empty string param", async () => {
    const handlers = [get("/api/servers/:serverId/status", () => ok("status"))];
    const res = await resolve(handlers, req("GET", "/api/servers//status"));
    expect(res).toBeUndefined();
  });

  it("matches a param that is the last segment", async () => {
    const handlers = [get("/api/servers/:serverId", ({ params }) => ok(params.serverId))];
    const res = await resolve(handlers, req("GET", "/api/servers/demo"));
    expect(await res?.text()).toBe("demo");
  });

  it("does not match a different method on the same route", async () => {
    const handlers = [get("/api/x", () => ok("get")), post("/api/x", () => ok("post"))];
    expect(await (await resolve(handlers, req("GET", "/api/x")))?.text()).toBe("get");
    expect(await (await resolve(handlers, req("POST", "/api/x")))?.text()).toBe("post");
  });

  it("has no built-in HEAD or OPTIONS handling: an unlisted method is unmatched", async () => {
    const handlers = [get("/api/x", () => ok("get"))];
    expect(await resolve(handlers, req("HEAD", "/api/x"))).toBeUndefined();
    expect(await resolve(handlers, req("OPTIONS", "/api/x"))).toBeUndefined();
  });

  it("uses the first handler that matches, in list order", async () => {
    const handlers = [get("/api/x", () => ok("first")), get("/api/x", () => ok("second"))];
    const res = await resolve(handlers, req("GET", "/api/x"));
    expect(await res?.text()).toBe("first");
  });

  it("resolves '..' before the router ever sees the path (the URL parser normalizes it)", async () => {
    const handlers = [get("/api/servers/:serverId/status", ({ params }) => ok(params.serverId))];
    const url = new URL("/api/servers/demo/../other/status", "https://demo.example");
    expect(url.pathname).toBe("/api/servers/other/status");
    const res = await resolve(handlers, new Request(url, { method: "GET" }));
    expect(await res?.text()).toBe("other");
  });

  it("treats a malformed percent-encoded param segment as no match, not a crash", async () => {
    // decodeURIComponent throws on a lone '%'; match() catches it and returns null, so this
    // is the demo's own "no demo data" 404 (via transport.ts), not an uncaught exception.
    const handlers = [get("/api/servers/:serverId/status", () => ok("status"))];
    await expect(resolve(handlers, req("GET", "/api/servers/100%/status"))).resolves.toBeUndefined();
  });
});
