import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { ApiFailure, NotEditableError, RateLimitedError } from "../../../platform/errorResponse.js";
import { createLogger } from "../../../platform/logger.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { seedPresetRules } from "../../alerts/repositories/alertRepository.js";
import { saveConnection, updateConnection } from "../../servers/repositories/connectionRepository.js";
import { softDeleteServer, upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { COMMAND_RETENTION_DAYS, MAX_OPEN_COMMANDS, expireStaleCommands, purgeOldCommands } from "../repositories/commandRepository.js";
import { createAgentsService } from "./agentsService.js";
import type { AgentsService } from "./agentsService.js";
import { CommandNotifier } from "./commandNotifier.js";
import { createCommandsService } from "./commandsService.js";
import type { AgentCommandsService, CommandsService } from "./commandsService.js";
import { createEnrollmentService } from "./enrollmentService.js";
import type { EnrollmentService } from "./enrollmentService.js";

const available = dbTestsAvailable();

const ACTOR = randomUUID();
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const silent = createLogger({ level: "silent" }, { write: () => {} });
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

/** The failure a call rejects with, or undefined if it resolved. */
async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (err) {
    return err;
  }
}
const codeOf = (err: unknown): string | undefined => (err instanceof ApiFailure ? err.code : err instanceof Error ? err.name : undefined);

// ADR-0031 PR 5b against a real Postgres: commands to an agent (create, poll, report, expire, purge), the auto-pause read,
// the agent_offline rule kind, and the enrolment codes that a saved connection drops (the migration is applied by
// createTestDatabase; the services run as satis_app, fixtures the app never writes go in as the admin).
describe.skipIf(!available)("agent commands against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;
  let agents: AgentsService;
  let enrollment: EnrollmentService;
  let commands: CommandsService & AgentCommandsService;
  let notifier: CommandNotifier;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 12 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    // Every test makes its own servers and codes: the per-user limit must not be what a test runs into.
    agents = createAgentsService({ db: pool, canManage: () => true, limiter: new UserRateLimiter({ max: 100_000, windowMs: 60_000 }) });
    enrollment = createEnrollmentService({ db: pool, cadence: () => CADENCE, logger: silent, attachAgentRuntime: async () => undefined });
    notifier = new CommandNotifier();
    commands = createCommandsService({ db: pool, notifier });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  /** A server reached through an enrolled agent. `uuid` is its internal id (the agent's identity for poll and report). */
  const newAgentServer = async () => {
    const server = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Commands" });
    await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [server.id]);
    await enrollment.enroll((await agents.createEnrollmentCode(server.publicId, ACTOR)).code, "0.1.0");
    return { publicId: server.publicId, agent: { serverUuid: server.id } };
  };
  const statusOf = async (id: string) => (await admin.query("SELECT status, sent_at, completed_at, result_code FROM agents.commands WHERE id = $1", [id])).rows[0] as
    | { status: string; sent_at: Date | null; completed_at: Date | null; result_code: string | null }
    | undefined;
  const auditActions = async (serverUuid: string) => (await admin.query("SELECT action, detail::text AS detail FROM audit.audit_events WHERE server_id = $1 ORDER BY id", [serverUuid])).rows as { action: string; detail: string }[];
  const expireNow = (id: string) => admin.query("UPDATE agents.commands SET expires_at = now() - interval '1 second' WHERE id = $1", [id]);

  describe("creating a command", () => {
    it("stores the target, who asked and a 60-second expiry, audits it without the target, and returns the contract's command", async () => {
      const { publicId, agent } = await newAgentServer();
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      expect(command).toMatchObject({ type: "set_auto_pause", status: "pending", completedAt: null, resultCode: null });
      const stored = (await admin.query("SELECT params, created_by, expires_at, created_at FROM agents.commands WHERE id = $1", [command.id])).rows[0];
      expect(stored.params).toEqual({ enabled: true });
      expect(stored.created_by).toBe(ACTOR);
      expect(stored.expires_at.getTime() - stored.created_at.getTime()).toBeCloseTo(60_000, -3);
      const audit = (await auditActions(agent.serverUuid)).filter((a) => a.action === "agent.command.created");
      expect(audit).toHaveLength(1);
      expect(JSON.parse(audit[0]!.detail)).toEqual({ type: "set_auto_pause", commandId: command.id });
    });

    it("is not editable for a local server, for an agent server with nothing enrolled, and after a revoke", async () => {
      const local = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Local" });
      expect(await failureOf(commands.requestAutoPause(local.publicId, true, ACTOR))).toBeInstanceOf(NotEditableError);
      const bare = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Bare" });
      await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [bare.id]);
      expect(await failureOf(commands.requestAutoPause(bare.publicId, true, ACTOR))).toBeInstanceOf(NotEditableError);
      const { publicId } = await newAgentServer();
      await agents.revoke(publicId, ACTOR);
      expect(await failureOf(commands.requestAutoPause(publicId, true, ACTOR))).toBeInstanceOf(NotEditableError);
    });

    it(`allows ${MAX_OPEN_COMMANDS} open commands and refuses the next with a rate limit; an expired one does not count`, async () => {
      const { publicId } = await newAgentServer();
      const made = [];
      for (let i = 0; i < MAX_OPEN_COMMANDS; i++) made.push(await commands.requestAutoPause(publicId, i % 2 === 0, ACTOR));
      expect(await failureOf(commands.requestAutoPause(publicId, true, ACTOR))).toBeInstanceOf(RateLimitedError);
      await expireNow(made[0]!.id);
      await expect(commands.requestAutoPause(publicId, true, ACTOR)).resolves.toHaveProperty("id");
    });

    it("concurrent requests never exceed the cap (the server row is locked while they count)", async () => {
      const { publicId } = await newAgentServer();
      const results = await Promise.allSettled(Array.from({ length: MAX_OPEN_COMMANDS + 4 }, () => commands.requestAutoPause(publicId, true, ACTOR)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_OPEN_COMMANDS);
      for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(RateLimitedError);
    });
  });

  describe("the agent's poll", () => {
    it("hands out the server's open commands, oldest first, and marks them sent; a second poll hands them out again", async () => {
      const { publicId, agent } = await newAgentServer();
      const first = await commands.requestAutoPause(publicId, true, ACTOR);
      const second = await commands.requestAutoPause(publicId, false, ACTOR);
      const polled = await commands.poll(agent, 0);
      expect(polled.map((c) => c.id)).toEqual([first.id, second.id]);
      expect(polled[0]).toEqual({ id: first.id, type: "set_auto_pause", params: { enabled: true }, expiresAt: first.expiresAt });
      const row = await statusOf(first.id);
      expect(row?.status).toBe("sent");
      expect(row?.sent_at).toBeInstanceOf(Date);
      expect((await commands.poll(agent, 0)).map((c) => c.id)).toEqual([first.id, second.id]);
    });

    it("never hands out another server's command, an expired one, or a finished one", async () => {
      const mine = await newAgentServer();
      const theirs = await newAgentServer();
      const stale = await commands.requestAutoPause(mine.publicId, true, ACTOR);
      const done = await commands.requestAutoPause(mine.publicId, true, ACTOR);
      const other = await commands.requestAutoPause(theirs.publicId, true, ACTOR);
      await expireNow(stale.id);
      await commands.report(mine.agent, done.id, { ok: true });
      expect(await commands.poll(mine.agent, 0)).toEqual([]);
      expect((await commands.poll(theirs.agent, 0)).map((c) => c.id)).toEqual([other.id]);
    });

    it("hasPending is true only while an open, unexpired command waits", async () => {
      const { publicId, agent } = await newAgentServer();
      expect(await commands.hasPending(agent.serverUuid)).toBe(false);
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      expect(await commands.hasPending(agent.serverUuid)).toBe(true);
      await commands.report(agent, command.id, { ok: true });
      expect(await commands.hasPending(agent.serverUuid)).toBe(false);
    });

    it("a long-poll is answered as soon as a command is created (the notifier wakes it), not at the end of the wait", async () => {
      const { publicId, agent } = await newAgentServer();
      const started = Date.now();
      const poll = commands.poll(agent, 25);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      const polled = await poll;
      expect(polled.map((c) => c.id)).toEqual([command.id]);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(notifier.waiting(agent.serverUuid)).toBe(0);
    });
  });

  describe("the agent's result", () => {
    it("a success is stored with its time and audited; a failure keeps its code", async () => {
      const { publicId, agent } = await newAgentServer();
      const ok = await commands.requestAutoPause(publicId, true, ACTOR);
      await commands.poll(agent, 0);
      await commands.report(agent, ok.id, { ok: true });
      expect(await statusOf(ok.id)).toMatchObject({ status: "succeeded", result_code: null });
      expect((await statusOf(ok.id))?.completed_at).toBeInstanceOf(Date);
      const bad = await commands.requestAutoPause(publicId, false, ACTOR);
      await commands.report(agent, bad.id, { ok: false, code: "upstream_auth_rejected" });
      expect(await statusOf(bad.id)).toMatchObject({ status: "failed", result_code: "upstream_auth_rejected" });
      const actions = (await auditActions(agent.serverUuid)).map((a) => a.action);
      expect(actions).toContain("agent.command.succeeded");
      expect(actions).toContain("agent.command.failed");
    });

    it("another server's agent cannot report a command that is not its own: command_not_found, and the command is untouched", async () => {
      const mine = await newAgentServer();
      const intruder = await newAgentServer();
      const command = await commands.requestAutoPause(mine.publicId, true, ACTOR);
      expect(codeOf(await failureOf(commands.report(intruder.agent, command.id, { ok: true })))).toBe("command_not_found");
      expect((await statusOf(command.id))?.status).toBe("pending");
      expect(codeOf(await failureOf(commands.report(mine.agent, randomUUID(), { ok: true })))).toBe("command_not_found");
    });

    it("a command that ran out before its result arrived is command_expired, and is marked expired", async () => {
      const { publicId, agent } = await newAgentServer();
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      await commands.poll(agent, 0);
      await expireNow(command.id);
      expect(codeOf(await failureOf(commands.report(agent, command.id, { ok: true })))).toBe("command_expired");
      expect((await statusOf(command.id))?.status).toBe("expired");
      // A late result never brings it back.
      expect(codeOf(await failureOf(commands.report(agent, command.id, { ok: true })))).toBe("command_expired");
      expect((await statusOf(command.id))?.status).toBe("expired");
    });

    it("a retried report changes nothing and audits nothing more", async () => {
      const { publicId, agent } = await newAgentServer();
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      await commands.report(agent, command.id, { ok: true });
      await expect(commands.report(agent, command.id, { ok: false, code: "upstream_error" })).resolves.toBeUndefined();
      expect(await statusOf(command.id)).toMatchObject({ status: "succeeded", result_code: null });
      const audits = (await auditActions(agent.serverUuid)).filter((a) => a.action.startsWith("agent.command.") && a.action !== "agent.command.created");
      expect(audits).toHaveLength(1);
    });

    it("when many reports of the same command race, exactly one is the result", async () => {
      const { publicId, agent } = await newAgentServer();
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      await Promise.all(Array.from({ length: 10 }, (_, i) => commands.report(agent, command.id, i === 0 ? { ok: true } : { ok: false, code: "upstream_error" })));
      const row = await statusOf(command.id);
      expect(["succeeded", "failed"]).toContain(row?.status);
      const audits = (await auditActions(agent.serverUuid)).filter((a) => a.action === "agent.command.succeeded" || a.action === "agent.command.failed");
      expect(audits).toHaveLength(1);
    });
  });

  describe("a command's status for the dashboard", () => {
    it("is this server's command; another server's id, an unknown id and a non-id are all command_not_found", async () => {
      const a = await newAgentServer();
      const b = await newAgentServer();
      const command = await commands.requestAutoPause(a.publicId, true, ACTOR);
      await expect(commands.getCommand(a.publicId, command.id)).resolves.toMatchObject({ id: command.id, status: "pending" });
      for (const [server, id] of [[b.publicId, command.id], [a.publicId, randomUUID()], [a.publicId, "not-an-id"]] as const) {
        expect(codeOf(await failureOf(commands.getCommand(server, id))), `${server} ${id}`).toBe("command_not_found");
      }
    });

    it("an open command past its expiry reads as expired even before the sweeper has written it", async () => {
      const { publicId } = await newAgentServer();
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      await expireNow(command.id);
      expect((await statusOf(command.id))?.status).toBe("pending");
      expect((await commands.getCommand(publicId, command.id)).status).toBe("expired");
    });

    it("a finished command shows its code and time", async () => {
      const { publicId, agent } = await newAgentServer();
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      await commands.report(agent, command.id, { ok: false, code: "upstream_unreachable" });
      expect(await commands.getCommand(publicId, command.id)).toMatchObject({ status: "failed", resultCode: "upstream_unreachable", completedAt: expect.any(String) });
    });
  });

  describe("the auto-pause setting of an agent server", () => {
    it("is unknown until the agent has confirmed a change, then the last confirmed value, and pending while one is on its way", async () => {
      const { publicId, agent } = await newAgentServer();
      expect(codeOf(await failureOf(commands.readAutoPause(publicId)))).toBe("upstream_unreachable");
      const first = await commands.requestAutoPause(publicId, false, ACTOR);
      expect(await commands.readAutoPause(publicId)).toEqual({ autoPause: false, pending: true, editable: true });
      await commands.report(agent, first.id, { ok: true });
      expect(await commands.readAutoPause(publicId)).toEqual({ autoPause: false, pending: false, editable: true });
      const second = await commands.requestAutoPause(publicId, true, ACTOR);
      expect(await commands.readAutoPause(publicId)).toEqual({ autoPause: true, pending: true, editable: true });
      await commands.report(agent, second.id, { ok: false, code: "upstream_error" });
      expect(await commands.readAutoPause(publicId)).toEqual({ autoPause: false, pending: false, editable: true });
      await expireNow((await commands.requestAutoPause(publicId, true, ACTOR)).id);
      expect(await commands.readAutoPause(publicId)).toEqual({ autoPause: false, pending: false, editable: true });
    });

    it("is not editable after a revoke", async () => {
      const { publicId, agent } = await newAgentServer();
      const command = await commands.requestAutoPause(publicId, false, ACTOR);
      await commands.report(agent, command.id, { ok: true });
      await agents.revoke(publicId, ACTOR);
      expect((await commands.readAutoPause(publicId)).editable).toBe(false);
    });
  });

  describe("sweeping", () => {
    it("expireStaleCommands writes `expired` on open commands past their expiry, and only those", async () => {
      const { publicId, agent } = await newAgentServer();
      const stale = await commands.requestAutoPause(publicId, true, ACTOR);
      const live = await commands.requestAutoPause(publicId, true, ACTOR);
      const done = await commands.requestAutoPause(publicId, true, ACTOR);
      await commands.report(agent, done.id, { ok: true });
      await expireNow(stale.id);
      await expireNow(done.id);
      await expireStaleCommands(pool);
      expect((await statusOf(stale.id))?.status).toBe("expired");
      expect((await statusOf(live.id))?.status).toBe("pending");
      expect((await statusOf(done.id))?.status).toBe("succeeded");
    });

    it(`purgeOldCommands deletes finished commands older than ${COMMAND_RETENTION_DAYS} days, never an open or a recent one`, async () => {
      const { publicId, agent } = await newAgentServer();
      const old = await commands.requestAutoPause(publicId, true, ACTOR);
      const recent = await commands.requestAutoPause(publicId, true, ACTOR);
      const open = await commands.requestAutoPause(publicId, true, ACTOR);
      await commands.report(agent, old.id, { ok: true });
      await commands.report(agent, recent.id, { ok: true });
      await admin.query("UPDATE agents.commands SET completed_at = now() - ($2::int * interval '1 day') WHERE id = $1", [old.id, COMMAND_RETENTION_DAYS + 1]);
      await purgeOldCommands(pool);
      expect(await statusOf(old.id)).toBeUndefined();
      expect(await statusOf(recent.id)).toBeDefined();
      expect(await statusOf(open.id)).toBeDefined();
    });
  });

  describe("the table's own rules", () => {
    it("refuses a command type or a result code outside the vocabulary, whatever writes it", async () => {
      const { agent } = await newAgentServer();
      await expect(admin.query("INSERT INTO agents.commands (server_id, type, params, expires_at) VALUES ($1, 'reboot', '{}', now())", [agent.serverUuid])).rejects.toThrow();
      await expect(admin.query("INSERT INTO agents.commands (server_id, type, params, expires_at, result_code) VALUES ($1, 'set_auto_pause', '{}', now(), 'free text')", [agent.serverUuid])).rejects.toThrow();
      await expect(admin.query("INSERT INTO agents.commands (server_id, type, params, expires_at) VALUES ($1, 'set_auto_pause', '[]', now())", [agent.serverUuid])).rejects.toThrow();
      await expect(admin.query("INSERT INTO agents.commands (server_id, type, params, expires_at, status) VALUES ($1, 'set_auto_pause', '{}', now(), 'lost')", [agent.serverUuid])).rejects.toThrow();
    });

    it("the runtime role can use it (grants), and a removed server takes its commands with it", async () => {
      const { publicId, agent } = await newAgentServer();
      const command = await commands.requestAutoPause(publicId, true, ACTOR);
      expect(await statusOf(command.id)).toBeDefined();
      expect(await softDeleteServer(pool, publicId)).toBe(true);
      expect(await statusOf(command.id)).toBeUndefined();
      expect((await admin.query("SELECT 1 FROM agents.commands WHERE server_id = $1", [agent.serverUuid])).rowCount).toBe(0);
    });
  });

  describe("saving a local connection drops the server's open enrolment codes (ADR-0031 PR 5b)", () => {
    const input = { host: "127.0.0.1", pinnedIp: "127.0.0.1", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abcdefgh1234", frmToken: "frm-token-abcdefgh5678" };
    const openCodes = async (serverUuid: string) => (await admin.query("SELECT 1 FROM agents.enrollment_codes WHERE server_id = $1 AND consumed_at IS NULL", [serverUuid])).rowCount;

    it("saveConnection", async () => {
      const server = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Local" });
      const { code } = await agents.createEnrollmentCode(server.publicId, ACTOR);
      expect(await openCodes(server.id)).toBe(1);
      expect(await saveConnection(pool, ring, server.id, input)).toBe(true);
      expect(await openCodes(server.id)).toBe(0);
      expect(codeOf(await failureOf(enrollment.enroll(code, "0.1.0")))).toBe("enrollment_code_invalid");
      // The server is still a local one, with its tokens.
      expect((await admin.query("SELECT connection_kind FROM servers.servers WHERE id = $1", [server.id])).rows[0].connection_kind).toBe("local");
    });

    it("updateConnection, and it leaves other servers' codes alone", async () => {
      const server = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Local" });
      const bystander = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Other" });
      await saveConnection(pool, ring, server.id, input);
      await agents.createEnrollmentCode(server.publicId, ACTOR);
      await agents.createEnrollmentCode(bystander.publicId, ACTOR);
      expect(await updateConnection(pool, ring, server.id, { apiPort: 7778 })).toBe(true);
      expect(await openCodes(server.id)).toBe(0);
      expect(await openCodes(bystander.id)).toBe(1);
    });

    it("a spent code is not touched (it is history)", async () => {
      const server = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Agent" });
      await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [server.id]);
      await enrollment.enroll((await agents.createEnrollmentCode(server.publicId, ACTOR)).code, "0.1.0");
      await admin.query("UPDATE servers.servers SET connection_kind = 'local' WHERE id = $1", [server.id]);
      await saveConnection(pool, ring, server.id, input);
      expect((await admin.query("SELECT 1 FROM agents.enrollment_codes WHERE server_id = $1 AND consumed_at IS NOT NULL", [server.id])).rowCount).toBe(1);
    });
  });

  describe("the agent_offline rule kind", () => {
    const kindsOf = async (publicId: string) =>
      (await admin.query("SELECT r.kind FROM alerts.rules r JOIN servers.servers s ON s.id = r.server_id WHERE s.public_id = $1 ORDER BY r.kind", [publicId])).rows.map((row: { kind: string }) => row.kind);

    it("is seeded as a preset for an agent server only, once, on top of the usual three", async () => {
      const polled = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Polled" });
      await seedPresetRules(pool, polled.publicId);
      expect(await kindsOf(polled.publicId)).toEqual(["power_outage", "server_unreachable", "stopped_machines"]);
      const { publicId } = await newAgentServer();
      await seedPresetRules(pool, publicId, { agent: true });
      await seedPresetRules(pool, publicId, { agent: true });
      expect(await kindsOf(publicId)).toEqual(["agent_offline", "power_outage", "server_unreachable", "stopped_machines"]);
      const preset = (await admin.query("SELECT params, for_seconds, clear_seconds, repeat_seconds, severity, enabled, preset FROM alerts.rules r JOIN servers.servers s ON s.id = r.server_id WHERE s.public_id = $1 AND r.kind = 'agent_offline'", [publicId])).rows[0];
      expect(preset).toEqual({ params: { offlineSeconds: 120 }, for_seconds: 0, clear_seconds: 60, repeat_seconds: 3600, severity: "critical", enabled: true, preset: true });
    });

    it("a server that becomes an agent server later gets it on the next seeding", async () => {
      const server = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Later" });
      await seedPresetRules(pool, server.publicId);
      expect(await kindsOf(server.publicId)).not.toContain("agent_offline");
      await seedPresetRules(pool, server.publicId, { agent: true });
      expect(await kindsOf(server.publicId)).toContain("agent_offline");
    });

    it("the rules table accepts the kind and still refuses an unknown one", async () => {
      const server = await upsertConfiguredServer(pool, { publicId: `cmd-${++counter}`, displayName: "Kinds" });
      await admin.query("INSERT INTO alerts.rules (server_id, kind, for_seconds, clear_seconds, repeat_seconds, severity) VALUES ($1, 'agent_offline', 0, 60, 3600, 'critical')", [server.id]);
      await expect(admin.query("INSERT INTO alerts.rules (server_id, kind, for_seconds, clear_seconds, repeat_seconds, severity) VALUES ($1, 'made_up', 0, 60, 3600, 'critical')", [server.id])).rejects.toThrow();
    });
  });
});
