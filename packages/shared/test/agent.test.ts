import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as fixtures from "../fixtures/index";
import {
  AGENT_RESULT_CODES,
  AgentCommandSchema,
  AgentCommandsQuerySchema,
  AgentStatusResponseSchema,
  ApiErrorResponseSchema,
  CadenceSchema,
  CommandAcceptedResponseSchema,
  CommandResultRequestSchema,
  CommandSchema,
  EnrollRequestSchema,
  EnrollResponseSchema,
  EnrollmentCodeSchema,
  KNOWN_AGENT_COMMAND_TYPES,
  KNOWN_COMMAND_STATUSES,
  KNOWN_CONNECTION_KINDS,
  KnownErrorCode,
  SetAutoPauseParamsSchema,
  SetAutoPauseResponseSchema,
  SnapshotRequestSchema,
  SnapshotResponseSchema,
  endpoints,
} from "../src/index";

describe("agent contract: enrolment", () => {
  it("a code is two groups of four base32 characters (A-Z and 2-7), upper case, one dash", () => {
    for (const ok of ["AB3D-7XQ2", "AAAA-2222", "ZZZZ-7777"]) expect(EnrollmentCodeSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["ab3d-7xq2", "AB3D7XQ2", "AB3D-7XQ", "AB3D-7XQ22", "AB3-D7XQ2", "AB3D-7XQ1", "AB3D-7XQ0", "AB3D-7XQ8", "AB3D-7XQ9", "AB3D_7XQ2", " AB3D-7XQ2", "AB3D-7XQ2\n", "", "ABCD-EFG!"]) {
      expect(EnrollmentCodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the request is strict: only the code and the agent's version, so no hostname or other machine detail can be sent", () => {
    expect(EnrollRequestSchema.safeParse(fixtures.agentEnrollRequest).success).toBe(true);
    for (const extra of [{ hostname: "pc" }, { machine: "x" }, { ip: "10.0.0.1" }, { user: "someone" }, { path: "C:/x" }]) {
      expect(EnrollRequestSchema.safeParse({ ...fixtures.agentEnrollRequest, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(EnrollRequestSchema.safeParse({ code: "AB3D-7XQ2" }).success).toBe(false);
    expect(EnrollRequestSchema.safeParse({ agentVersion: "0.1.0" }).success).toBe(false);
  });

  it("the agent version is 1 to 32 characters", () => {
    const v = (agentVersion: string) => EnrollRequestSchema.safeParse({ code: "AB3D-7XQ2", agentVersion }).success;
    expect([v(""), v("1"), v("x".repeat(32)), v("x".repeat(33))]).toEqual([false, true, true, false]);
  });

  it("the response carries the secret, the server's public id and the cadence, and tolerates fields a newer backend adds", () => {
    expect(EnrollResponseSchema.parse({ ...fixtures.agentEnrollResponse, newerField: 1 })).toEqual(fixtures.agentEnrollResponse);
    expect(fixtures.agentEnrollResponse.agentSecret).toHaveLength(43);
    expect(fixtures.agentEnrollResponse.agentSecret).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url, 256 bits
    expect(EnrollResponseSchema.safeParse({ ...fixtures.agentEnrollResponse, serverId: "Not A Server" }).success).toBe(false);
  });
});

describe("agent contract: cadence", () => {
  it("each interval is a whole number of seconds from 1 to 3600", () => {
    const c = (over: object) => CadenceSchema.safeParse({ statusSeconds: 5, powerSeconds: 5, factorySeconds: 30, ...over }).success;
    expect([c({}), c({ statusSeconds: 0 }), c({ statusSeconds: 1 }), c({ powerSeconds: 3600 }), c({ powerSeconds: 3601 }), c({ factorySeconds: 2.5 }), c({ factorySeconds: -1 }), c({ factorySeconds: "30" })]).toEqual([
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(CadenceSchema.safeParse({ statusSeconds: 5, powerSeconds: 5 }).success).toBe(false);
  });

  it("every field has the same 1..3600 bounds (each edge, both sides)", () => {
    for (const field of ["statusSeconds", "powerSeconds", "factorySeconds"]) {
      const c = (value: number) => CadenceSchema.safeParse({ statusSeconds: 5, powerSeconds: 5, factorySeconds: 30, [field]: value }).success;
      expect([c(0), c(1), c(3600), c(3601)], field).toEqual([false, true, true, false]);
    }
  });

  it("the enrolment request's version is bounded at 32 and a code with a look-alike character is refused", () => {
    const req = (over: object) => EnrollRequestSchema.safeParse({ code: "AB3D-7XQ2", agentVersion: "1.0.0", ...over }).success;
    expect([req({ agentVersion: "a".repeat(32) }), req({ agentVersion: "a".repeat(33) }), req({ agentVersion: "" })]).toEqual([true, false, false]);
    for (const code of ["AB3D-7XQ2", "АB3D-7XQ2", "AB3D‐7XQ2", "AB3D-７XQ2"]) {
      expect(req({ code }), code).toBe(code === "AB3D-7XQ2"); // the first is a plain ASCII 2, the rest are look-alikes
    }
  });
});

describe("agent contract: snapshots", () => {
  it("accepts a full snapshot, a partial one and an unreachable one", () => {
    for (const snapshot of [fixtures.agentSnapshotRequestFull, fixtures.agentSnapshotRequestPartial, fixtures.agentSnapshotRequestUnreachable]) {
      expect(SnapshotRequestSchema.safeParse(snapshot).success).toBe(true);
    }
  });

  it("the parts are the SAME shapes the live routes return (their data): a bad part is refused", () => {
    expect(fixtures.agentSnapshotRequestFull.status).toEqual(fixtures.statusRunning.data);
    expect(fixtures.agentSnapshotRequestFull.factory).toEqual(fixtures.factoryMixed.data);
    const bad = (part: object) => SnapshotRequestSchema.safeParse({ ...fixtures.agentSnapshotRequestFull, ...part }).success;
    expect([bad({ status: { tickHealth: "great" } }), bad({ power: { circuits: "none" } }), bad({ factory: { buildings: 1 } }), bad({ players: { available: "yes" } })]).toEqual([false, false, false, false]);
  });

  it("an unreachable game sends no parts: `reachable: false` with any part is refused, and `paused` may be null", () => {
    for (const part of ["status", "power", "factory", "players"] as const) {
      const withPart = { ...fixtures.agentSnapshotRequestUnreachable, [part]: fixtures.agentSnapshotRequestFull[part] };
      expect(SnapshotRequestSchema.safeParse(withPart).success, part).toBe(false);
    }
    expect(SnapshotRequestSchema.safeParse({ ...fixtures.agentSnapshotRequestFull, paused: null }).success).toBe(true);
    expect(SnapshotRequestSchema.safeParse({ ...fixtures.agentSnapshotRequestUnreachable, paused: undefined }).success).toBe(false); // required, null when unknown
  });

  it("`settings` is optional as a whole; when present it is strict and `autoPause` must be a boolean", () => {
    const withSettings = (settings: unknown) => SnapshotRequestSchema.safeParse({ ...fixtures.agentSnapshotRequestPartial, settings }).success;
    expect(SnapshotRequestSchema.safeParse(fixtures.agentSnapshotRequestPartial).success).toBe(true);
    expect([withSettings({ autoPause: false }), withSettings({ autoPause: true }), withSettings(undefined)]).toEqual([true, true, true]);
    expect([withSettings({}), withSettings({ autoPause: "yes" }), withSettings({ autoPause: null }), withSettings({ autoPause: true, extra: 1 }), withSettings(null)]).toEqual([false, false, false, false, false]);
  });

  it("`settings` is not a data part: allowed on an unreachable snapshot, and it round-trips through parse and z.input", () => {
    const unreachable = { ...fixtures.agentSnapshotRequestUnreachable, settings: { autoPause: false } };
    expect(SnapshotRequestSchema.safeParse(unreachable).success).toBe(true);
    const parsed = SnapshotRequestSchema.parse(fixtures.agentSnapshotRequestFull);
    expect(parsed.settings).toEqual({ autoPause: true });
    const input: z.input<typeof SnapshotRequestSchema> = { ...fixtures.agentSnapshotRequestPartial, settings: { autoPause: true } };
    expect(SnapshotRequestSchema.safeParse(input).success).toBe(true);
  });

  it("the request is strict (no machine details) and needs the time, with an offset or Z", () => {
    for (const extra of [{ hostname: "pc" }, { ip: "10.0.0.1" }, { os: "windows" }]) {
      expect(SnapshotRequestSchema.safeParse({ ...fixtures.agentSnapshotRequestPartial, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    const at = (observedAt: unknown) => SnapshotRequestSchema.safeParse({ ...fixtures.agentSnapshotRequestPartial, observedAt }).success;
    expect([at("2026-09-26T12:00:00Z"), at("2026-09-26T12:00:00.123+02:00"), at("2026-09-26T12:00:00-05:30"), at("2026-09-26T12:00:00"), at("2026-09-26"), at("yesterday"), at(1758888000000), at(undefined)]).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("the snapshot fixtures carry nothing about the machine", () => {
    const text = JSON.stringify([fixtures.agentSnapshotRequestFull, fixtures.agentSnapshotRequestUnreachable, fixtures.agentEnrollRequest]);
    expect(text).not.toMatch(/hostname|\bhost\b|machine|username|C:\\\\|C:\/|\/home\/|\/Users\//i);
  });

  it("the response is the cadence and whether a command is waiting, and tolerates extra fields", () => {
    expect(SnapshotResponseSchema.parse({ ...fixtures.agentSnapshotResponse, later: true })).toEqual(fixtures.agentSnapshotResponse);
    expect(SnapshotResponseSchema.safeParse({ cadence: fixtures.agentSnapshotResponse.cadence }).success).toBe(false);
    expect(fixtures.agentSnapshotResponseCommandWaiting.commandsPending).toBe(true);
  });
});

describe("agent contract: commands", () => {
  it("the long-poll wait is 0 to 25 seconds, default 0", () => {
    expect(AgentCommandsQuerySchema.parse({})).toEqual({ waitSeconds: 0 });
    expect(AgentCommandsQuerySchema.parse({ waitSeconds: "25" })).toEqual({ waitSeconds: 25 });
    for (const waitSeconds of ["26", "-1", "1.5", "abc", "1e2"]) expect(AgentCommandsQuerySchema.safeParse({ waitSeconds }).success, waitSeconds).toBe(false);
  });

  it("an agent survives a newer backend: an unknown command type parses, and its params stay a record", () => {
    const [known, unknown] = fixtures.agentCommandsList.commands;
    expect(KNOWN_AGENT_COMMAND_TYPES).toContain(known!.type);
    expect(KNOWN_AGENT_COMMAND_TYPES).not.toContain(unknown!.type);
    expect(AgentCommandSchema.parse(unknown)).toEqual(unknown);
    expect(AgentCommandSchema.safeParse({ ...known, params: "nope" }).success).toBe(false);
    expect(fixtures.agentCommandsEmpty.commands).toEqual([]);
  });

  it("set_auto_pause has typed, strict params", () => {
    expect(SetAutoPauseParamsSchema.parse(fixtures.agentCommandsList.commands[0]!.params)).toEqual({ enabled: false });
    for (const bad of [{}, { enabled: "true" }, { enabled: true, extra: 1 }]) expect(SetAutoPauseParamsSchema.safeParse(bad).success).toBe(false);
  });

  it("a result is ok, or not ok with an optional code from the closed list; a success carries no code; free text is refused", () => {
    expect(AGENT_RESULT_CODES).toEqual(["unsupported", "upstream_unreachable", "upstream_auth_rejected", "upstream_error"]);
    for (const code of AGENT_RESULT_CODES) expect(CommandResultRequestSchema.safeParse({ ok: false, code }).success, code).toBe(true);
    expect(CommandResultRequestSchema.safeParse({ ok: false }).success).toBe(true);
    expect(CommandResultRequestSchema.safeParse(fixtures.agentResultRequestOk).success).toBe(true);
    expect(CommandResultRequestSchema.safeParse({ ok: true, code: "upstream_error" }).success).toBe(false);
    for (const bad of [{ ok: false, code: "the game said: token abc123" }, { ok: false, code: "" }, { ok: false, message: "text" }, { ok: "yes" }, {}]) {
      expect(CommandResultRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("agent contract: what the user sees", () => {
  it("the agent status is enrolled with its version and last contact, or not enrolled with nulls", () => {
    expect(AgentStatusResponseSchema.parse(fixtures.agentStatusEnrolled).enrolled).toBe(true);
    expect(fixtures.agentStatusNotEnrolled).toMatchObject({ enrolled: false, lastSeenAt: null, agentVersion: null, connectionKind: "local" });
    expect(fixtures.agentStatusEnrolledSilent.lastSeenAt).toBeNull();
    expect(KNOWN_CONNECTION_KINDS).toEqual(["local", "agent"]);
  });

  it("kinds, types and statuses are plain strings, so a newer backend never breaks an older frontend", () => {
    expect(AgentStatusResponseSchema.safeParse({ ...fixtures.agentStatusEnrolled, connectionKind: "relay" }).success).toBe(true);
    expect(CommandSchema.safeParse({ ...fixtures.commandPending.command, type: "restart_frm", status: "cancelled" }).success).toBe(true);
    expect(AgentCommandSchema.safeParse({ id: "c", type: "future", params: {}, expiresAt: "2026-09-26T12:00:00Z" }).success).toBe(true);
  });

  it("there is a command fixture for every known status, and only terminal ones have a completion time", () => {
    const byStatus = [fixtures.commandPending, fixtures.commandSent, fixtures.commandSucceeded, fixtures.commandFailed, fixtures.commandExpired];
    expect(byStatus.map((c) => c.command.status)).toEqual([...KNOWN_COMMAND_STATUSES]);
    expect(byStatus.map((c) => c.command.completedAt === null)).toEqual([true, true, false, false, false]);
    expect(fixtures.commandFailed.command.resultCode).toBe("upstream_unreachable");
    expect(fixtures.commandSucceeded.command.resultCode).toBeNull();
  });

  it("the enrolment code answer carries the code and its expiry", () => {
    expect(EnrollmentCodeSchema.safeParse(fixtures.agentEnrollmentCodeResponse.code).success).toBe(true);
    expect(new Date(fixtures.agentEnrollmentCodeResponse.expiresAt).getTime()).toBeGreaterThan(0);
  });
});

describe("agent contract: edge cases found by the fresh-eyes pass", () => {
  it("a settings body that also carries a stray `command` key parses as the setting with the key stripped, so `\"command\" in x` stays a sound narrowing", () => {
    const parsed = SetAutoPauseResponseSchema.parse({ ...fixtures.autoPauseResponseSetting, command: fixtures.commandPending.command });
    expect("command" in parsed).toBe(false);
    expect(parsed).toEqual(fixtures.autoPauseResponseSetting);
  });

  it("a 202 body tolerates extra fields (also inside the command) and is never read as a setting", () => {
    const parsed = SetAutoPauseResponseSchema.parse({ command: { ...fixtures.commandPending.command, futureField: 1 }, extra: true });
    expect("command" in parsed).toBe(true);
    expect("data" in parsed).toBe(false);
  });

  it("an explicit `undefined` part on an unreachable snapshot counts as absent, but null does not", () => {
    const base = fixtures.agentSnapshotRequestUnreachable;
    expect(SnapshotRequestSchema.safeParse({ ...base, status: undefined, power: undefined, factory: undefined, players: undefined }).success).toBe(true);
    expect(SnapshotRequestSchema.safeParse({ ...base, status: null }).success).toBe(false);
  });

  it("a reachable snapshot with no parts is allowed (only unreachable forbids parts)", () => {
    expect(SnapshotRequestSchema.safeParse({ ...fixtures.agentSnapshotRequestUnreachable, reachable: true }).success).toBe(true);
  });
});

describe("agent contract: the auto-pause answer is additive", () => {
  it("parses today's 200 (the setting) AND the 202 (the command to poll), and tells them apart", () => {
    expect(SetAutoPauseResponseSchema.parse(fixtures.autoPauseResponseSetting)).toEqual(fixtures.autoPauseResponseSetting);
    expect(SetAutoPauseResponseSchema.parse(fixtures.autoPauseResponseAccepted)).toEqual(fixtures.autoPauseResponseAccepted);
    expect("command" in fixtures.autoPauseResponseAccepted).toBe(true);
    expect("data" in fixtures.autoPauseResponseSetting).toBe(true);
    expect(CommandAcceptedResponseSchema.safeParse(fixtures.autoPauseResponseSetting).success).toBe(false);
  });

  it("refuses anything that is neither", () => {
    for (const bad of [{}, { command: {} }, { data: {} }, null, "ok"]) expect(SetAutoPauseResponseSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("the endpoint's response schema is the union", () => {
    expect(endpoints.settings.setAutoPause.response).toBe(SetAutoPauseResponseSchema);
  });
});

describe("agent contract: endpoints", () => {
  it("the agent API is under /agent/v1, NOT /api/servers, with the documented methods", () => {
    const all = Object.values(endpoints.agentApi);
    expect(all.map((e) => `${e.method} ${e.route}`)).toEqual([
      "POST /agent/v1/enroll",
      "POST /agent/v1/snapshots",
      "GET /agent/v1/commands",
      "POST /agent/v1/commands/:commandId/result",
    ]);
    expect(all.every((e) => !e.route.startsWith("/api"))).toBe(true);
  });

  it("the path builders encode the command id", () => {
    expect(endpoints.agentApi.enroll.path()).toBe("/agent/v1/enroll");
    expect(endpoints.agentApi.result.path("cmd_1")).toBe("/agent/v1/commands/cmd_1/result");
    expect(endpoints.agentApi.result.path("a/b c")).toBe("/agent/v1/commands/a%2Fb%20c/result");
    expect(endpoints.commands.get.path("srv", "a/b")).toBe("/api/servers/srv/commands/a%2Fb");
  });

  it("the user-facing routes are under /api/servers/:serverId (so the membership tests select them)", () => {
    expect(
      [endpoints.agent.enrollmentCode, endpoints.agent.status, endpoints.agent.revoke, endpoints.commands.get].map((e) => `${e.method} ${e.route.replace("/api/servers/:serverId", "")}`),
    ).toEqual(["POST /agent/enrollment-codes", "GET /agent", "DELETE /agent", "GET /commands/:commandId"]);
  });

  it("every agent write that takes a body has a strict request schema, and the GETs have none", () => {
    expect("request" in endpoints.agentApi.enroll && "request" in endpoints.agentApi.snapshots && "request" in endpoints.agentApi.result).toBe(true);
    expect("request" in endpoints.agentApi.commands).toBe(false);
    expect("query" in endpoints.agentApi.commands).toBe(true);
  });
});

describe("agent contract: errors", () => {
  const codes = ["enrollment_code_invalid", "agent_outdated", "command_not_found", "command_expired"];
  it("the new codes are known, each has a fixture, and an agent's auth failure reuses `unauthorized`", () => {
    for (const code of codes) expect(KnownErrorCode.safeParse(code).success, code).toBe(true);
    const errors = [fixtures.errorEnrollmentCodeInvalid, fixtures.errorAgentOutdated, fixtures.errorCommandNotFound, fixtures.errorCommandExpired];
    expect(errors.map((e) => e.error.code)).toEqual(codes);
    expect(fixtures.errorAgentUnauthorized.error.code).toBe("unauthorized");
    for (const e of [...errors, fixtures.errorAgentUnauthorized]) expect(ApiErrorResponseSchema.safeParse(e).success).toBe(true);
  });

  it("no message echoes a code, a secret or a hostname", () => {
    for (const e of [fixtures.errorEnrollmentCodeInvalid, fixtures.errorAgentOutdated, fixtures.errorCommandNotFound, fixtures.errorCommandExpired, fixtures.errorAgentUnauthorized]) {
      expect(e.error.message).not.toMatch(/[A-Z2-7]{4}-[A-Z2-7]{4}|secret|token|host/i);
    }
  });
});
