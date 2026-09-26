import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { CommandSchema } from "@satisfactory-dash/shared";
import { ApiFailure, NotEditableError, RateLimitedError, ServerNotFoundError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { MAX_OPEN_COMMANDS } from "../repositories/commandRepository.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { CommandNotifier } from "./commandNotifier.js";
import { createCommandsService } from "./commandsService.js";
import type { ReportedAutoPause } from "./commandsService.js";
import { snapshot } from "../../../platform/snapshot.js";

const SERVER_UUID = "11111111-1111-4111-8111-111111111111";
const COMMAND_ID = "6f1c0a52-9b1e-4c53-8a52-0d5d7e2f3a11";
const OTHER_ID = "0a0a0a0a-1111-4222-8333-444444444444";
const T0 = Date.parse("2026-09-26T12:00:00.000Z");

/** Names each statement by what it does, so a test can say "lock, count, insert, audit" instead of quoting SQL. */
function kindOf(text: string): string {
  if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return text;
  if (text.includes("FOR NO KEY UPDATE")) return "lock";
  if (text.includes("LEFT JOIN agents.agent_credentials")) return "agent-status";
  if (text.includes("SELECT count(*)::int")) return "count-open";
  if (text.includes("INSERT INTO agents.commands")) return "insert";
  if (text.includes("INSERT INTO audit.audit_events")) return "audit";
  if (text.includes("SET status = 'sent'")) return "claim";
  if (text.includes("SELECT EXISTS")) return "has-open";
  if (text.includes("SET status = $3")) return "complete";
  if (text.includes("past_expiry")) return "look-up";
  if (text.includes("SET status = 'expired', completed_at = now()")) return "mark-expired";
  if (text.includes("c.id = $2::uuid")) return "get";
  if (text.includes("ORDER BY c.created_at DESC")) return "recent";
  return text.slice(0, 40);
}

type Answer = (kind: string, values: unknown[]) => { rows: unknown[] } | Error | undefined;

/** A pool whose one client answers by statement kind and remembers every statement in order. */
function fakePool(answer: Answer) {
  const log: { kind: string; text: string; values: unknown[] }[] = [];
  const query = async (text: string, values: unknown[] = []) => {
    const kind = kindOf(text);
    log.push({ kind, text, values });
    const result = answer(kind, values);
    if (result instanceof Error) throw result;
    return result ?? { rows: [] };
  };
  const client = Object.assign(new EventEmitter(), { query, release() {} }) as unknown as PoolClient;
  return { log, kinds: () => log.map((entry) => entry.kind), pool: { connect: async () => client, query } as never };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: COMMAND_ID,
  type: "set_auto_pause",
  params: { enabled: true },
  status: "pending",
  created_at: new Date(T0),
  expires_at: new Date(T0 + 60_000),
  completed_at: null,
  result_code: null,
  ...overrides,
});
const auditRow = { rows: [{ id: 1, at: new Date(T0), actor_user_id: null, server_id: SERVER_UUID, action: "x", detail: {} }] };
const enrolledAgentServer: Answer = (kind) => {
  switch (kind) {
    case "lock":
      return { rows: [{ id: SERVER_UUID, connection_kind: "agent" }] };
    case "agent-status":
      return { rows: [{ connection_kind: "agent", enrolled: true, last_seen_at: null, agent_version: "0.1.0" }] };
    case "count-open":
      return { rows: [{ count: 0 }] };
    case "insert":
      return { rows: [row()] };
    case "audit":
      return auditRow;
    default:
      return undefined;
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe("requestAutoPause", () => {
  it("creates the command in one transaction with its audit event, then wakes the agent's poll AFTER the commit", async () => {
    const { pool, kinds, log } = fakePool(enrolledAgentServer);
    const notifier = new CommandNotifier();
    const notified: string[][] = [];
    notifier.notify = (serverUuid: string) => notified.push([serverUuid, ...log.map((entry) => entry.kind)]);
    const service = createCommandsService({ db: pool, notifier });
    const command = await service.requestAutoPause("alpha", true, "user-1");
    expect(kinds()).toEqual(["BEGIN", "lock", "agent-status", "count-open", "insert", "audit", "COMMIT"]);
    expect(CommandSchema.parse(command)).toEqual({
      id: COMMAND_ID,
      type: "set_auto_pause",
      status: "pending",
      createdAt: "2026-09-26T12:00:00.000Z",
      expiresAt: "2026-09-26T12:01:00.000Z",
      completedAt: null,
      resultCode: null,
    });
    // The poll is woken after COMMIT, so the row it looks for is there.
    expect(notified).toHaveLength(1);
    expect(notified[0]![0]).toBe(SERVER_UUID);
    expect(notified[0]).toContain("COMMIT");
  });

  it("stores the target and who asked; the audit event carries ids and the type only, never the target", async () => {
    const { pool, log } = fakePool(enrolledAgentServer);
    await createCommandsService({ db: pool, notifier: new CommandNotifier() }).requestAutoPause("alpha", false, "user-1");
    const insert = log.find((entry) => entry.kind === "insert")!;
    expect(insert.values).toEqual([SERVER_UUID, "set_auto_pause", JSON.stringify({ enabled: false }), 60_000, "user-1"]);
    const audit = log.find((entry) => entry.kind === "audit")!;
    expect(audit.values[2]).toBe("agent.command.created");
    expect(JSON.parse(audit.values[3] as string)).toEqual({ type: "set_auto_pause", commandId: COMMAND_ID });
  });

  it("is not editable for a server this backend reaches directly, and for an agent server with no enrolled agent", async () => {
    for (const answer of [
      (kind: string) => (kind === "lock" ? { rows: [{ id: SERVER_UUID, connection_kind: "local" }] } : kind === "agent-status" ? { rows: [{ connection_kind: "local", enrolled: false, last_seen_at: null, agent_version: null }] } : undefined),
      (kind: string) => (kind === "lock" ? { rows: [{ id: SERVER_UUID, connection_kind: "agent" }] } : kind === "agent-status" ? { rows: [{ connection_kind: "agent", enrolled: false, last_seen_at: null, agent_version: null }] } : undefined),
    ]) {
      const { pool, kinds } = fakePool(answer);
      const notifier = new CommandNotifier();
      const notify = vi.spyOn(notifier, "notify");
      const failure = await createCommandsService({ db: pool, notifier }).requestAutoPause("alpha", true, "user-1").catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(NotEditableError);
      expect(kinds()).not.toContain("insert");
      expect(kinds().at(-1)).toBe("ROLLBACK");
      expect(notify).not.toHaveBeenCalled();
    }
  });

  it("an unknown or removed server is server_not_found", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    expect(await createCommandsService({ db: pool, notifier: new CommandNotifier() }).requestAutoPause("nope", true, undefined).catch((err: unknown) => err)).toBeInstanceOf(ServerNotFoundError);
  });

  it(`refuses a ${MAX_OPEN_COMMANDS + 1}th open command with a 429 rather than piling them up for the agent`, async () => {
    const { pool, kinds } = fakePool((kind, values) => (kind === "count-open" ? { rows: [{ count: MAX_OPEN_COMMANDS }] } : enrolledAgentServer(kind, values)));
    const failure = await createCommandsService({ db: pool, notifier: new CommandNotifier() }).requestAutoPause("alpha", true, "u").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(RateLimitedError);
    expect(kinds()).not.toContain("insert");
  });

  it("limits how many changes one person can make per minute (the server's cap of open commands does not stop one admin filling it)", async () => {
    const { pool, kinds } = fakePool(enrolledAgentServer);
    const service = createCommandsService({ db: pool, notifier: new CommandNotifier(), limiter: new UserRateLimiter({ max: 2, windowMs: 60_000 }) });
    await service.requestAutoPause("alpha", true, "user-1");
    await service.requestAutoPause("alpha", false, "user-1");
    const before = kinds().length;
    expect(await service.requestAutoPause("alpha", true, "user-1").catch((err: unknown) => err)).toBeInstanceOf(RateLimitedError);
    expect(kinds()).toHaveLength(before); // refused before it touched the database
    await expect(service.requestAutoPause("alpha", true, "user-2")).resolves.toHaveProperty("id");
    await expect(service.requestAutoPause("alpha", true, undefined)).resolves.toHaveProperty("id");
  });

  it("one below the cap still works", async () => {
    const { pool } = fakePool((kind, values) => (kind === "count-open" ? { rows: [{ count: MAX_OPEN_COMMANDS - 1 }] } : enrolledAgentServer(kind, values)));
    await expect(createCommandsService({ db: pool, notifier: new CommandNotifier() }).requestAutoPause("alpha", true, "u")).resolves.toHaveProperty("id");
  });

  it("a database outage is a 503", async () => {
    const { pool } = fakePool(() => Object.assign(new Error("boom"), { code: "ECONNREFUSED" }));
    expect(await createCommandsService({ db: pool, notifier: new CommandNotifier() }).requestAutoPause("alpha", true, "u").catch((err: unknown) => err)).toBeInstanceOf(ServiceUnavailableError);
  });
});

describe("getCommand", () => {
  it("returns this server's command in the contract's shape", async () => {
    const { pool, log } = fakePool((kind) => (kind === "get" ? { rows: [row({ status: "succeeded", completed_at: new Date(T0 + 7000) })] } : undefined));
    const command = await createCommandsService({ db: pool, notifier: new CommandNotifier() }).getCommand("alpha", COMMAND_ID);
    expect(CommandSchema.parse(command)).toMatchObject({ id: COMMAND_ID, status: "succeeded", completedAt: "2026-09-26T12:00:07.000Z", resultCode: null });
    expect(log[0]!.values).toEqual(["alpha", COMMAND_ID]); // scoped by the server's public id
  });

  it("an unknown command, another server's, and a string that is not an id are all the same 404 command_not_found", async () => {
    const { pool, log } = fakePool(() => ({ rows: [] }));
    const service = createCommandsService({ db: pool, notifier: new CommandNotifier() });
    for (const id of [OTHER_ID, "not-an-id", "'; DROP TABLE agents.commands;--", ""]) {
      const failure = await service.getCommand("alpha", id).catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(ApiFailure);
      expect((failure as ApiFailure).code).toBe("command_not_found");
    }
    // The ids that are not ids never reached the database.
    expect(log.map((entry) => entry.values[1])).toEqual([OTHER_ID]);
  });

  it("shows a failed command's code", async () => {
    const { pool } = fakePool(() => ({ rows: [row({ status: "failed", result_code: "upstream_unreachable", completed_at: new Date(T0 + 7000) })] }));
    expect(await createCommandsService({ db: pool, notifier: new CommandNotifier() }).getCommand("alpha", COMMAND_ID)).toMatchObject({ status: "failed", resultCode: "upstream_unreachable" });
  });
});

describe("readAutoPause", () => {
  const withRecent = (recent: Record<string, unknown>[], status: Record<string, unknown> = { connection_kind: "agent", enrolled: true, last_seen_at: null, agent_version: null }) =>
    fakePool((kind) => (kind === "agent-status" ? { rows: [status] } : kind === "recent" ? { rows: recent } : undefined)).pool;
  const read = (pool: never) => createCommandsService({ db: pool, notifier: new CommandNotifier() }).readAutoPause("alpha");

  it("is the last value the agent confirmed", async () => {
    const pool = withRecent([row({ id: "a", status: "failed", params: { enabled: true } }), row({ id: "b", status: "succeeded", params: { enabled: false } }), row({ id: "c", status: "succeeded", params: { enabled: true } })]);
    expect(await read(pool)).toEqual({ autoPause: false, pending: false, editable: true });
  });

  it("while a change is waiting it shows the value being applied, and says pending", async () => {
    const pool = withRecent([row({ status: "sent", params: { enabled: true } }), row({ id: "b", status: "succeeded", params: { enabled: false } })]);
    expect(await read(pool)).toEqual({ autoPause: true, pending: true, editable: true });
  });

  it("a failed or expired change leaves the last confirmed value", async () => {
    const pool = withRecent([row({ status: "expired", params: { enabled: true } }), row({ id: "b", status: "succeeded", params: { enabled: false } })]);
    expect(await read(pool)).toEqual({ autoPause: false, pending: false, editable: true });
  });

  it("is unknown (upstream_unreachable) before any change was confirmed: the snapshot carries no auto-pause field", async () => {
    for (const recent of [[], [row({ status: "failed" })], [row({ status: "expired" })]]) {
      const failure = await read(withRecent(recent)).catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(ApiFailure);
      expect((failure as ApiFailure).code).toBe("upstream_unreachable");
    }
  });

  it("ignores a stored command whose target is not a boolean, rather than guessing", async () => {
    const failure = await read(withRecent([row({ status: "succeeded", params: { enabled: "yes" } })])).catch((err: unknown) => err);
    expect((failure as ApiFailure).code).toBe("upstream_unreachable");
  });

  it("is editable only while an agent is enrolled", async () => {
    const pool = withRecent([row({ status: "succeeded", params: { enabled: false } })], { connection_kind: "agent", enrolled: false, last_seen_at: null, agent_version: null });
    expect(await read(pool)).toEqual({ autoPause: false, pending: false, editable: false });
  });

  it("an unknown server is server_not_found", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    expect(await read(pool).catch((err: unknown) => err)).toBeInstanceOf(ServerNotFoundError);
  });

  describe("with the agent's own reading (settings.autoPause in its snapshots)", () => {
    const readWith = (pool: never, reported?: ReportedAutoPause) => createCommandsService({ db: pool, notifier: new CommandNotifier() }).readAutoPause("alpha", reported);
    const reading = (autoPause: boolean, atMs: number, stale = false): ReportedAutoPause => ({ autoPause, observedAtMs: atMs, stale });
    const confirmedAt = (enabled: boolean, atMs: number) => row({ id: "c1", status: "succeeded", params: { enabled }, completed_at: new Date(atMs) });

    it("is known from the reading alone, with the reading's own time and staleness on the envelope", async () => {
      const data = await readWith(withRecent([]), reading(true, T0, true));
      expect(data).toEqual({ autoPause: true, pending: false, editable: true });
      expect(snapshot("alpha", data)).toMatchObject({ observedAt: new Date(T0).toISOString(), stale: true, data: { autoPause: true } });
    });

    it("a change being applied wins over the reading, and stays pending", async () => {
      const pool = withRecent([row({ status: "pending", params: { enabled: true } })]);
      expect(await readWith(pool, reading(false, T0))).toEqual({ autoPause: true, pending: true, editable: true });
    });

    it("a reading taken AFTER the last confirmed change wins (an edit made in the game since)", async () => {
      const pool = withRecent([confirmedAt(false, T0)]);
      expect(await readWith(pool, reading(true, T0 + 5000))).toEqual({ autoPause: true, pending: false, editable: true });
    });

    it("a reading taken BEFORE the last confirmed change is out of date: the confirmed value wins", async () => {
      const pool = withRecent([confirmedAt(false, T0)]);
      const data = await readWith(pool, reading(true, T0 - 5000));
      expect(data).toEqual({ autoPause: false, pending: false, editable: true });
      expect(snapshot("alpha", data).stale).toBe(false); // the confirmed value is served as before this change
    });

    it("no reading changes nothing: the last confirmed value, or unknown", async () => {
      expect(await readWith(withRecent([confirmedAt(false, T0)]), undefined)).toEqual({ autoPause: false, pending: false, editable: true });
      const failure = await readWith(withRecent([]), undefined).catch((err: unknown) => err);
      expect((failure as ApiFailure).code).toBe("upstream_unreachable");
    });
  });
});

describe("poll (the agent's long-poll)", () => {
  const agent = { serverUuid: SERVER_UUID };
  const later = row({ id: "cmd-2", created_at: new Date(T0 + 5000), expires_at: new Date(T0 + 65_000) });
  const earlier = row({ id: "cmd-1" });

  it("with waitSeconds 0 asks once and never subscribes", async () => {
    const { pool, kinds } = fakePool((kind) => (kind === "claim" ? { rows: [later, earlier] } : undefined));
    const notifier = new CommandNotifier();
    const subscribe = vi.spyOn(notifier, "subscribe");
    const commands = await createCommandsService({ db: pool, notifier }).poll(agent, 0);
    expect(commands.map((command) => command.id)).toEqual(["cmd-1", "cmd-2"]); // oldest first
    expect(commands[0]).toEqual({ id: "cmd-1", type: "set_auto_pause", params: { enabled: true }, expiresAt: "2026-09-26T12:01:00.000Z" });
    expect(kinds()).toEqual(["claim"]);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("asks for the credential's own server only", async () => {
    const { pool, log } = fakePool(() => ({ rows: [] }));
    await createCommandsService({ db: pool, notifier: new CommandNotifier() }).poll(agent, 0);
    expect(log[0]!.values).toEqual([SERVER_UUID]);
  });

  it("returns at once when a command is already there, without waiting or leaving a waiter", async () => {
    const { pool } = fakePool((kind) => (kind === "claim" ? { rows: [earlier] } : undefined));
    const notifier = new CommandNotifier();
    const commands = await createCommandsService({ db: pool, notifier }).poll(agent, 25);
    expect(commands).toHaveLength(1);
    expect(notifier.waiting(SERVER_UUID)).toBe(0);
  });

  it("waits, and is answered the moment a command is created for its server", async () => {
    let claims = 0;
    const { pool } = fakePool((kind) => (kind === "claim" ? { rows: ++claims === 1 ? [] : [earlier] } : undefined));
    const notifier = new CommandNotifier();
    const poll = createCommandsService({ db: pool, notifier }).poll(agent, 25);
    await vi.waitFor(() => expect(notifier.waiting(SERVER_UUID)).toBe(1));
    notifier.notify(SERVER_UUID);
    expect((await poll).map((command) => command.id)).toEqual(["cmd-1"]);
    expect(notifier.waiting(SERVER_UUID)).toBe(0);
  });

  it("a command created between the poll's look and its wait still wakes it (it subscribes BEFORE looking)", async () => {
    const notifier = new CommandNotifier();
    let claims = 0;
    const { pool } = fakePool((kind) => {
      if (kind !== "claim") return undefined;
      if (++claims === 1) {
        notifier.notify(SERVER_UUID); // created just now, after the first look found nothing
        return { rows: [] };
      }
      return { rows: [earlier] };
    });
    vi.useFakeTimers();
    const commands = await createCommandsService({ db: pool, notifier }).poll(agent, 25); // no timer advance: must not need the 25 s
    expect(commands.map((command) => command.id)).toEqual(["cmd-1"]);
  });

  it("is an empty list when the wait is up with nothing to do, and clamps waitSeconds to 25", async () => {
    vi.useFakeTimers();
    const { pool, log } = fakePool(() => ({ rows: [] }));
    const notifier = new CommandNotifier();
    const poll = createCommandsService({ db: pool, notifier }).poll(agent, 9999);
    await vi.advanceTimersByTimeAsync(24_999);
    let done = false;
    void poll.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await poll).toEqual([]);
    expect(notifier.waiting(SERVER_UUID)).toBe(0);
    expect(log.filter((entry) => entry.kind === "claim")).toHaveLength(2); // before and after the wait
  });

  it("stops waiting when the agent hangs up, answers nothing, and leaves no waiter", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    const notifier = new CommandNotifier();
    const controller = new AbortController();
    const poll = createCommandsService({ db: pool, notifier }).poll(agent, 25, controller.signal);
    await vi.waitFor(() => expect(notifier.waiting(SERVER_UUID)).toBe(1));
    controller.abort();
    expect(await poll).toEqual([]);
    expect(notifier.waiting(SERVER_UUID)).toBe(0);
  });

  it("a database error is a 503 and does not leave a waiter behind", async () => {
    const { pool } = fakePool(() => Object.assign(new Error("boom"), { code: "ECONNREFUSED" }));
    const notifier = new CommandNotifier();
    expect(await createCommandsService({ db: pool, notifier }).poll(agent, 25).catch((err: unknown) => err)).toBeInstanceOf(ServiceUnavailableError);
    expect(notifier.waiting(SERVER_UUID)).toBe(0);
  });
});

describe("report (the agent's result)", () => {
  const agent = { serverUuid: SERVER_UUID };
  const outcome = (found: "accepted" | "already" | "missing" | "expired"): Answer => (kind) => {
    if (kind === "complete") return { rows: found === "accepted" ? [{ id: COMMAND_ID }] : [] };
    if (kind === "look-up") {
      if (found === "missing") return { rows: [] };
      if (found === "already") return { rows: [{ status: "succeeded", past_expiry: false }] };
      return { rows: [{ status: "sent", past_expiry: true }] };
    }
    return kind === "audit" ? auditRow : undefined;
  };

  it("a success is stored, scoped to the agent's own server, and audited (ids only)", async () => {
    const { pool, log } = fakePool(outcome("accepted"));
    await createCommandsService({ db: pool, notifier: new CommandNotifier() }).report(agent, COMMAND_ID, { ok: true });
    const complete = log.find((entry) => entry.kind === "complete")!;
    expect(complete.values).toEqual([COMMAND_ID, SERVER_UUID, "succeeded", null]);
    const audit = log.find((entry) => entry.kind === "audit")!;
    expect(audit.values[2]).toBe("agent.command.succeeded");
    expect(JSON.parse(audit.values[3] as string)).toEqual({ commandId: COMMAND_ID });
  });

  it("a failure keeps its code (a fixed vocabulary, never free text)", async () => {
    const { pool, log } = fakePool(outcome("accepted"));
    await createCommandsService({ db: pool, notifier: new CommandNotifier() }).report(agent, COMMAND_ID, { ok: false, code: "upstream_auth_rejected" });
    expect(log.find((entry) => entry.kind === "complete")!.values).toEqual([COMMAND_ID, SERVER_UUID, "failed", "upstream_auth_rejected"]);
    const audit = log.find((entry) => entry.kind === "audit")!;
    expect(audit.values[2]).toBe("agent.command.failed");
    expect(JSON.parse(audit.values[3] as string)).toEqual({ commandId: COMMAND_ID, code: "upstream_auth_rejected" });
  });

  it("a code on a success is dropped, not stored", async () => {
    const { pool, log } = fakePool(outcome("accepted"));
    await createCommandsService({ db: pool, notifier: new CommandNotifier() }).report(agent, COMMAND_ID, { ok: true, code: "upstream_error" });
    expect(log.find((entry) => entry.kind === "complete")!.values[3]).toBeNull();
  });

  it("an unknown command, or another server's, is command_not_found and writes no audit event", async () => {
    const { pool, kinds } = fakePool(outcome("missing"));
    const failure = await createCommandsService({ db: pool, notifier: new CommandNotifier() }).report(agent, OTHER_ID, { ok: true }).catch((err: unknown) => err);
    expect((failure as ApiFailure).code).toBe("command_not_found");
    expect(kinds()).not.toContain("audit");
  });

  it("a command that ran out before its result arrived is command_expired, marked expired, with no audit event", async () => {
    const { pool, kinds } = fakePool(outcome("expired"));
    const failure = await createCommandsService({ db: pool, notifier: new CommandNotifier() }).report(agent, COMMAND_ID, { ok: true }).catch((err: unknown) => err);
    expect((failure as ApiFailure).code).toBe("command_expired");
    expect(kinds()).toContain("mark-expired");
    expect(kinds()).not.toContain("audit");
  });

  it("a retried report of an already finished command is accepted and changes nothing (no second audit event)", async () => {
    const { pool, kinds } = fakePool(outcome("already"));
    await expect(createCommandsService({ db: pool, notifier: new CommandNotifier() }).report(agent, COMMAND_ID, { ok: false, code: "upstream_error" })).resolves.toBeUndefined();
    expect(kinds()).not.toContain("audit");
  });
});

describe("hasPending", () => {
  const agentUuid = SERVER_UUID;
  it("says whether an open command waits", async () => {
    expect(await createCommandsService({ db: fakePool((kind) => (kind === "has-open" ? { rows: [{ open: true }] } : undefined)).pool, notifier: new CommandNotifier() }).hasPending(agentUuid)).toBe(true);
    expect(await createCommandsService({ db: fakePool((kind) => (kind === "has-open" ? { rows: [{ open: false }] } : undefined)).pool, notifier: new CommandNotifier() }).hasPending(agentUuid)).toBe(false);
  });

  it("is false, never an error, when the database fails: it is only a hint on the snapshot answer", async () => {
    const { pool } = fakePool(() => new Error("down"));
    expect(await createCommandsService({ db: pool, notifier: new CommandNotifier() }).hasPending(agentUuid)).toBe(false);
  });
});
