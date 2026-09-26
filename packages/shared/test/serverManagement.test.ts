import { describe, expect, it } from "vitest";
import {
  CreateServerRequestSchema,
  ServerConnectionSchema,
  ServerListResponseSchema,
  TestConnectionRequestSchema,
  UpdateServerRequestSchema,
  endpoints,
} from "../src";

// ADR-0030: the contract for managing servers.
const create = { id: "alt", displayName: "Alt", host: "192.168.1.30", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abc123" };

describe("CreateServerRequestSchema", () => {
  it("accepts a hostname, an IPv4 address or an IPv6 literal, with an optional FRM token", () => {
    for (const host of ["gaming-pc.lan", "192.168.1.30", "::1", "[::1]", "fd12::1"]) {
      expect(CreateServerRequestSchema.safeParse({ ...create, host }).success, host).toBe(true);
    }
    expect(CreateServerRequestSchema.safeParse({ ...create, frmToken: "frm-token-abc" }).success).toBe(true);
  });

  it.each([
    ["an unknown field", { extra: true }],
    ["a URL as the host", { host: "https://192.168.1.30" }],
    ["a host with a path", { host: "host/path" }],
    ["a host with credentials", { host: "user:pw@host" }],
    ["a host with a space", { host: "my host" }],
    ["an empty host", { host: "" }],
    ["port 0", { apiPort: 0 }],
    ["port 65536", { frmPort: 65536 }],
    ["a fractional port", { apiPort: 77.5 }],
    ["a string port", { apiPort: "7777" }],
    ["an empty API token", { apiToken: "" }],
    ["an empty FRM token", { frmToken: "" }],
    ["a token with a space", { apiToken: "a b" }],
    ["a token with a newline", { apiToken: "a\nb" }],
    ["a token with a non-ASCII character", { apiToken: "tökén" }],
    ["a token over 4096 characters", { apiToken: "a".repeat(4097) }],
    ["an id that is not a server id", { id: "Not Valid" }],
    ["the reserved id test-connection", { id: "test-connection" }],
    ["a blank display name", { displayName: "   " }],
    ["a display name over 64 characters", { displayName: "x".repeat(65) }],
  ])("refuses %s", (_label, change) => {
    expect(CreateServerRequestSchema.safeParse({ ...create, ...change }).success).toBe(false);
  });
});

describe("UpdateServerRequestSchema", () => {
  it("takes any subset of fields, and null clears the FRM token", () => {
    expect(UpdateServerRequestSchema.safeParse({ displayName: "New" }).success).toBe(true);
    expect(UpdateServerRequestSchema.safeParse({ frmToken: null }).success).toBe(true);
    expect(UpdateServerRequestSchema.safeParse({ apiPort: 1, host: "h" }).success).toBe(true);
  });

  it.each([
    ["nothing at all", {}],
    ["only undefined values", { host: undefined }],
    ["an empty FRM token", { frmToken: "" }],
    ["a null API token", { apiToken: null }],
    ["an id (it cannot change)", { id: "other" }],
    ["an unknown field", { nope: 1 }],
  ])("refuses %s", (_label, body) => {
    expect(UpdateServerRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("TestConnectionRequestSchema", () => {
  it("is the connection fields only (no id or name)", () => {
    const { id: _id, displayName: _name, ...candidate } = create;
    expect(TestConnectionRequestSchema.safeParse(candidate).success).toBe(true);
    expect(TestConnectionRequestSchema.safeParse(create).success).toBe(false);
  });
});

describe("responses never carry a token", () => {
  it("ServerConnectionSchema strips a token even if one is passed", () => {
    const parsed = ServerConnectionSchema.parse({
      id: "alt", displayName: "Alt", host: "h", apiPort: 1, frmPort: 2, apiTokenSet: true, apiTokenLast4: "1234",
      frmTokenSet: false, frmTokenLast4: null, state: "ok", plainHttpOverLan: false, apiToken: "secret-token", frmToken: "secret-frm",
    });
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
});

describe("the contract's operator-only endpoints", () => {
  it("are marked, all under serverManagement, and nothing else is", () => {
    const marked = Object.entries(endpoints).flatMap(([group, value]) =>
      "route" in value
        ? "operatorOnly" in value ? [group] : []
        : Object.entries(value).filter(([, e]) => "operatorOnly" in e).map(([name]) => `${group}.${name}`),
    );
    expect(marked.sort()).toEqual([
      "serverManagement.create",
      "serverManagement.get",
      "serverManagement.remove",
      "serverManagement.testConnection",
      "serverManagement.testSaved",
      "serverManagement.update",
    ]);
  });

  it("keeps the list additive: canManageServers is optional", () => {
    expect(ServerListResponseSchema.safeParse({ servers: [] }).success).toBe(true);
    expect(ServerListResponseSchema.safeParse({ servers: [], canManageServers: true }).success).toBe(true);
  });
});
