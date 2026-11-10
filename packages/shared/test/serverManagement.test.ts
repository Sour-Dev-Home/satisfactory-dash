import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  CreateAgentServerRequestSchema,
  CreateAgentServerResponseSchema,
  RESERVED_SERVER_IDS,
  DisplayNameSchema,
  NON_PRINTABLE_IN_NAME,
  ManagedServerListResponseSchema,
  RenameServerRequestSchema,
  RenameServerResponseSchema,
  KnownErrorCode,
  ServerListResponseSchema,
  endpoints,
} from "../src";
import * as contract from "../src";

// ADR-0030, narrowed by ADR-0066: the contract for managing servers.

describe("ADR-0066 Decision 8 Step B: the direct-poll contract is gone", () => {
  it("exports none of the direct-poll schemas", () => {
    for (const name of [
      "CreateServerRequestSchema",
      "UpdateServerRequestSchema",
      "TestConnectionRequestSchema",
      "TestConnectionResponseSchema",
      "ConnectionCheckSchema",
      "ServerConnectionSchema",
      "ServerConnectionResponseSchema",
      "SwitchToLocalRequestSchema",
    ]) {
      expect(Object.hasOwn(contract, name), name).toBe(false);
    }
  });

  it("declares none of the direct-poll endpoints", () => {
    expect(Object.keys(endpoints.serverManagement).sort()).toEqual(["list", "remove", "renameAgent"]);
  });

  it("the managed list has no `servers` field: an older backend's `servers` is stripped, never trusted", () => {
    const parsed = ManagedServerListResponseSchema.parse({ servers: [{ id: "a" }], ...fixtures.managedServersWithAgent });
    expect(Object.keys(parsed)).toEqual(["agentServers"]);
    expect(ManagedServerListResponseSchema.parse(fixtures.managedServersEmpty)).toEqual({ agentServers: [] });
  });

  it("keeps the error codes the removed routes used (stored clients may still see them during a rolling deploy)", () => {
    expect(KnownErrorCode.safeParse("server_not_agent").success).toBe(true);
  });
});

// ADR-0046: self-serve agent servers.
describe("self-serve agent servers", () => {
  it("reserves `agent` so no server id collides with POST /api/servers/agent", () => {
    // An id once reserved stays reserved (ADR-0066), even though test-connection's route is gone.
    expect(RESERVED_SERVER_IDS).toEqual(["test-connection", "managed", "agent"]);
  });

  it("the create request is the display name only, with the existing bounds", () => {
    expect(CreateAgentServerRequestSchema.safeParse({ displayName: "My server" }).success).toBe(true);
    for (const bad of [{}, { displayName: "" }, { displayName: "x".repeat(65) }, { displayName: "A", id: "a" }]) {
      expect(CreateAgentServerRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the create response is the existing agent-server view", () => {
    const server = fixtures.managedServersWithAgent.agentServers[0];
    expect(CreateAgentServerResponseSchema.safeParse({ server }).success).toBe(true);
    expect(CreateAgentServerResponseSchema.safeParse({ server: { ...server, kind: "local" } }).success).toBe(false);
  });

  it("declares POST /api/servers/agent for any signed-in user (not operator only)", () => {
    const e = endpoints.selfServe.createAgentServer;
    expect([e.method, e.route, e.path()]).toEqual(["POST", "/api/servers/agent", "/api/servers/agent"]);
    expect("operatorOnly" in e).toBe(false);
  });

  it("flags exactly renameAgent and remove as selfServeOwner (adding the flag elsewhere is a visible change)", () => {
    const flagged = Object.entries(endpoints).flatMap(([group, value]) =>
      "route" in value
        ? "selfServeOwner" in value ? [group] : []
        : Object.entries(value).filter(([, e]) => "selfServeOwner" in e).map(([name]) => `${group}.${name}`),
    );
    expect(flagged.sort()).toEqual(["serverManagement.remove", "serverManagement.renameAgent"]);
  });
});

describe("the contract's operator-only endpoints", () => {
  it("are marked, all under serverManagement, and nothing else is", () => {
    const marked = Object.entries(endpoints).flatMap(([group, value]) =>
      "route" in value
        ? "operatorOnly" in value ? [group] : []
        : Object.entries(value).filter(([, e]) => "operatorOnly" in e).map(([name]) => `${group}.${name}`),
    );
    expect(marked.sort()).toEqual(["serverManagement.list", "serverManagement.remove", "serverManagement.renameAgent"]);
  });

  it("keeps the managed list additive: `agentServers` is optional, and each entry is id, name and kind `agent` only", () => {
    expect(ManagedServerListResponseSchema.safeParse({}).success).toBe(true); // an older backend that omits it
    expect(ManagedServerListResponseSchema.safeParse({ servers: [] }).success).toBe(true); // a backend from before ADR-0066 PR 8
    expect(ManagedServerListResponseSchema.safeParse(fixtures.managedServersWithAgent).success).toBe(true);
    const entry = fixtures.managedServersWithAgent.agentServers[0];
    for (const bad of [{ ...entry, kind: "local" }, { ...entry, kind: undefined }, { id: entry.id, kind: "agent" }, { ...entry, id: "Not A Valid Id!" }]) {
      expect(ManagedServerListResponseSchema.safeParse({ agentServers: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
    // No connection field can ride along (they are stripped, never trusted): an agent server has none.
    const parsed = ManagedServerListResponseSchema.parse({ agentServers: [{ ...entry, host: "10.0.0.1", apiPort: 7777 }] });
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

  it("applies to create and rename alike, and the rule is exported so every entry point shares it", () => {
    const evil = "Home‮gpj.exe";
    expect(CreateAgentServerRequestSchema.safeParse({ displayName: evil }).success).toBe(false);
    expect(RenameServerRequestSchema.safeParse({ displayName: evil }).success).toBe(false);
    expect(CreateAgentServerRequestSchema.safeParse({ displayName: "Home" }).success).toBe(true);
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

  it("the limit counts characters, not UTF-16 units: 64 astral emoji are fine, 65 are not", () => {
    expect(accepted("🏭".repeat(64))).toBe(true);
    expect(accepted("🏭".repeat(65))).toBe(false);
  });

  it("refuses invisible-looking filler characters: Hangul fillers, Braille blank, combining grapheme joiner, Khmer inherent vowels, Unicode tag characters", () => {
    for (const cp of [0x3164, 0x115f, 0x1160, 0xffa0, 0x2800, 0x034f, 0x17b4, 0x17b5, 0x180e, 0xe0041, 0xe007f]) {
      expect(accepted(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toBe(false);
    }
  });

  it("refuses inner look-alike spaces (no-break, ideographic, en/em) but keeps the plain space", () => {
    for (const cp of [0xa0, 0x1680, 0x2003, 0x2009, 0x202f, 0x205f, 0x3000]) {
      expect(accepted(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toBe(false);
    }
    expect(accepted("a b")).toBe(true);
  });

  it("refuses a stack of combining marks (zalgo) but keeps ordinary accents and emoji variation selectors", () => {
    expect(accepted("e" + "́".repeat(3))).toBe(true);
    expect(accepted("e" + "́".repeat(4))).toBe(false);
    expect(accepted("Z" + "̀́̂̃̄̅̆")).toBe(false);
    expect(accepted("☢️ ✔️")).toBe(true);
  });

  it("keeps the list additive for the same reason: canManageServers is optional", () => {
    expect(ServerListResponseSchema.safeParse({ servers: [] }).success).toBe(true);
    expect(ServerListResponseSchema.safeParse({ servers: [], canManageServers: true }).success).toBe(true);
  });
});
