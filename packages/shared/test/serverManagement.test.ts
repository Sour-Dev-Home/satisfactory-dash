import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  CreateServerRequestSchema,
  DisplayNameSchema,
  NON_PRINTABLE_IN_NAME,
  ManagedServerListResponseSchema,
  RenameServerRequestSchema,
  RenameServerResponseSchema,
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
    ["the reserved id managed (it is the list route)", { id: "managed" }],
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

describe("ManagedServerListResponseSchema", () => {
  const row = { id: "a", displayName: "A", host: "h", apiPort: 1, frmPort: 2, apiTokenSet: true, apiTokenLast4: null, frmTokenSet: false, frmTokenLast4: null, plainHttpOverLan: false };
  it("carries every state, and refuses an unknown one", () => {
    for (const state of ["ok", "unreadable", "refused"]) {
      expect(ManagedServerListResponseSchema.safeParse({ servers: [{ ...row, state }] }).success, state).toBe(true);
    }
    expect(ManagedServerListResponseSchema.safeParse({ servers: [{ ...row, state: "gone" }] }).success).toBe(false);
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
      "serverManagement.list",
      "serverManagement.remove",
      "serverManagement.renameAgent",
      "serverManagement.testConnection",
      "serverManagement.testSaved",
      "serverManagement.update",
    ]);
  });

  it("keeps the managed list additive: `agentServers` is optional, and each entry is id, name and kind `agent` only", () => {
    expect(ManagedServerListResponseSchema.safeParse({ servers: [] }).success).toBe(true); // an older backend
    expect(ManagedServerListResponseSchema.safeParse(fixtures.managedServersWithAgent).success).toBe(true);
    const entry = fixtures.managedServersWithAgent.agentServers[0];
    for (const bad of [{ ...entry, kind: "local" }, { ...entry, kind: undefined }, { id: entry.id, kind: "agent" }, { ...entry, id: "Not A Valid Id!" }]) {
      expect(ManagedServerListResponseSchema.safeParse({ servers: [], agentServers: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
    // No connection field can ride along (they are stripped, never trusted): an agent server has none.
    const parsed = ManagedServerListResponseSchema.parse({ servers: [], agentServers: [{ ...entry, host: "10.0.0.1", apiPort: 7777 }] });
    expect(Object.keys(parsed.agentServers![0]!).sort()).toEqual(["displayName", "id", "kind"]);
  });

  it("the rename request is a trimmed name of 1 to 64 characters and nothing else, and its answer is the agent server", () => {
    expect(RenameServerRequestSchema.parse({ displayName: "  Name  " })).toEqual({ displayName: "Name" });
    for (const bad of [{}, { displayName: "" }, { displayName: "   " }, { displayName: "x".repeat(65) }, { displayName: "ok", host: "10.0.0.1" }, { displayName: 5 }]) {
      expect(RenameServerRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(RenameServerRequestSchema.safeParse(fixtures.renameAgentServerRequest).success).toBe(true);
    expect(RenameServerResponseSchema.parse(fixtures.renameAgentServerResponse).server.kind).toBe("agent");
    expect(endpoints.serverManagement.renameAgent).toMatchObject({ method: "PATCH", route: "/api/servers/:serverId/name", operatorOnly: true });
    expect(endpoints.serverManagement.renameAgent.path("alex")).toBe("/api/servers/alex/name");
  });

  it("keeps the list additive: canManageServers is optional", () => {
    expect(ServerListResponseSchema.safeParse({ servers: [] }).success).toBe(true);
  });
});

describe("a server's display name is printable text (issue #198)", () => {
  const accepted = (name: string) => DisplayNameSchema.safeParse(name).success;

  it("accepts ordinary names: letters in any script, digits, marks, punctuation, symbols, emoji and plain spaces", () => {
    for (const name of ["Home", "Factory two", "Fábrica número 2", "工厂一号", "Завод-3", "Åsa's base (north)", "Base #1 · v2", "Nuclear ☢️ plant", "🏭 Main", "a".repeat(64), "x y  z", "İstanbul", "é (combining mark)"]) {
      expect(accepted(name), name).toBe(true);
    }
  });

  it("refuses control characters: line breaks, tab, NUL, escape, delete, and the C1 controls", () => {
    for (const bad of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u001bb", "a\u007fb", "a\u0085b", "a\u009fb", "line1\r\nline2"]) {
      expect(accepted(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses direction-changing and invisible format characters (Cf): bidi overrides and isolates, zero-width, BOM, soft hyphen", () => {
    for (const bad of ["safe‮evil", "a‭b", "a‪b", "a‫b", "a‬b", "a⁦b", "a⁧b", "a⁨b", "a⁩b", "a‎b", "a‏b", "a​b", "a‌b", "a‍b", "a⁠b", "na﻿me", "a­b", "a؜b"]) {
      expect(accepted(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses line and paragraph separators, lone surrogates, private-use and unassigned code points", () => {
    for (const bad of ["a b", "a b", "a\uD800b", "ab", "a͸b", "a\u{F0000}b"]) {
      expect(accepted(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("checks AFTER trimming, so surrounding spaces are fine but a hidden character inside is not, and a name of only invisible characters is refused", () => {
    expect(DisplayNameSchema.parse("  Home  ")).toBe("Home");
    expect(DisplayNameSchema.parse("﻿Home")).toBe("Home"); // a leading BOM is whitespace to trim(): stripped, never stored
    expect(accepted("   ​   ")).toBe(false);
    expect(accepted("‮")).toBe(false);
    expect(accepted("   ")).toBe(false); // blank
  });

  it("applies to create, update and rename alike, and the rule is exported so every entry point shares it", () => {
    const evil = "Home‮gpj.exe";
    expect(CreateServerRequestSchema.safeParse({ ...create, displayName: evil }).success).toBe(false);
    expect(UpdateServerRequestSchema.safeParse({ displayName: evil }).success).toBe(false);
    expect(RenameServerRequestSchema.safeParse({ displayName: evil }).success).toBe(false);
    expect(CreateServerRequestSchema.safeParse({ ...create, displayName: "Home" }).success).toBe(true);
    expect(NON_PRINTABLE_IN_NAME.test("a‮b")).toBe(true);
    expect(NON_PRINTABLE_IN_NAME.test("plain")).toBe(false);
  });

  it("an emoji joined with the zero-width joiner is refused (a documented consequence: use the single-character form)", () => {
    expect(accepted("👨‍👩‍👧 family")).toBe(false);
    expect(accepted("👪 family")).toBe(true);
  });

  it("the length limit still holds in characters, and an over-long name is refused whatever it holds", () => {
    expect(accepted("x".repeat(65))).toBe(false);
    expect(accepted("é".repeat(64))).toBe(true);
  });

  it("keeps the list additive for the same reason: canManageServers is optional", () => {
    expect(ServerListResponseSchema.safeParse({ servers: [] }).success).toBe(true);
    expect(ServerListResponseSchema.safeParse({ servers: [], canManageServers: true }).success).toBe(true);
  });
});
