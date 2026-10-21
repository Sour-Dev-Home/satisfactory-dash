import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { AgentCommandsResponseSchema, ApiErrorResponseSchema, CommandResultResponseSchema, EnrollResponseSchema, SnapshotResponseSchema } from "@satisfactory-dash/shared";
import { agentEnrollRequest, agentEnrollResponse, agentSnapshotRequestFull, agentSnapshotRequestUnreachable } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { ApiFailure, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { TokenBucketLimiter } from "../../../platform/tokenBucket.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { createMetricsAggregator, type MetricsSink } from "../../../platform/metrics/index.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { sha256 } from "../repositories/agentRepository.js";
import { createAgentAuth } from "../services/agentAuth.js";
import type { AgentCommandsService } from "../services/commandsService.js";
import type { EnrollmentService } from "../services/enrollmentService.js";
import { createAgentApiRouter } from "./agentApi.js";

const SECRET = "S".repeat(43);
const REVOKED_SECRET = "R".repeat(43);
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

/** A database that knows one live credential (alpha) and answers a revoked or unknown one with no row, like the real join. */
function fakeDb(options: { down?: boolean } = {}) {
  const touches: string[] = [];
  const versions: string[] = [];
  const db: Queryable = {
    async query(text, values = []) {
      if (options.down) throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
      if (text.includes("secret_hash = $1")) {
        const hash = values[0] as Buffer;
        return { rows: hash.equals(sha256(SECRET)) ? [{ server_id: "11111111-1111-4111-8111-111111111111", public_id: "alpha" }] : [] };
      }
      if (text.includes("SET last_seen_at")) touches.push(String(values[0]));
      if (text.includes("SET agent_version")) versions.push(String(values[1]));
      return { rows: [] };
    },
  };
  return { db, touches, versions };
}

function build(
  overrides: Partial<Parameters<typeof createAgentApiRouter>[0]> & { db?: ReturnType<typeof fakeDb>; logWrite?: (line: string) => void; now?: () => number } = {},
) {
  const database = overrides.db ?? fakeDb();
  const ingest = vi.fn();
  const enroll = vi.fn<EnrollmentService["enroll"]>(async () => agentEnrollResponse);
  const directory = new InMemoryServerDirectory([
    { id: "alpha", displayName: "Alpha", services: { telemetry: { agentIngest: { ingest } } } },
    { id: "beta", displayName: "Beta", services: { telemetry: {} } },
  ]);
  const attachAgentRuntime = vi.fn(async () => undefined);
  const now = overrides.now ?? (() => 1_000_000);
  const commands = agentCommandsStub();
  const app = createApp({
    logger: createLogger({ level: overrides.logWrite ? "info" : "silent" }, { write: overrides.logWrite ?? (() => {}) }),
    routers: [],
    agentRouters: [
      createAgentApiRouter({
        auth: createAgentAuth({ db: database.db, now }),
        enrollment: { enroll },
        commands,
        directory: directory as never,
        attachAgentRuntime,
        recordVersion: async (serverUuid, version) => {
          await database.db.query("UPDATE agents.agent_credentials SET agent_version = $2 WHERE server_id = $1", [serverUuid, version]);
        },
        cadence: () => CADENCE,
        now,
        ...overrides,
      }),
    ],
  });
  return { app, ingest, enroll, attachAgentRuntime, database, directory, commands };
}

/** An agent-commands service that has nothing to say, its calls recorded. */
function agentCommandsStub() {
  return {
    poll: vi.fn<AgentCommandsService["poll"]>(async () => []),
    report: vi.fn<AgentCommandsService["report"]>(async () => undefined),
    hasPending: vi.fn<AgentCommandsService["hasPending"]>(async () => false),
  };
}

const bearer = (secret: string) => `Bearer ${secret}`;
/** superagent JSON-serializes a Buffer body when the content type is JSON; a gzip body must go out as the bytes it is. */
const rawBody = (body: Buffer): string => body as unknown as string; // typed as a string; superagent then writes the bytes as they are
const postSnapshot = (app: ReturnType<typeof build>["app"], body: unknown = agentSnapshotRequestFull, secret = SECRET) =>
  request(app).post("/agent/v1/snapshots").set("Authorization", bearer(secret)).set("Content-Type", "application/json").send(JSON.stringify(body));

describe("POST /agent/v1/enroll", () => {
  it("trades a valid code for the credential (201, the contract's shape, never cached)", async () => {
    const { app, enroll } = build();
    const res = await request(app).post("/agent/v1/enroll").send(agentEnrollRequest);
    expect(res.status).toBe(201);
    expect(EnrollResponseSchema.parse(res.body)).toEqual(agentEnrollResponse);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(enroll).toHaveBeenCalledWith(agentEnrollRequest.code, agentEnrollRequest.agentVersion);
  });

  it("needs no session and no credential: the code is the credential", async () => {
    const res = await request(build().app).post("/agent/v1/enroll").send(agentEnrollRequest);
    expect(res.status).toBe(201);
  });

  it.each([
    ["a code of the wrong shape", { code: "ab3d-7xq2", agentVersion: "0.1.0" }],
    ["a missing version", { code: "AB3D-7XQ2" }],
    ["an unknown field (the request is strict)", { ...agentEnrollRequest, hostname: "my-pc" }],
  ])("refuses %s with a fixed message that echoes nothing", async (_name, body) => {
    const { app, enroll } = build();
    const res = await request(app).post("/agent/v1/enroll").send(body);
    expect(res.status).toBe(400);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("bad_request");
    expect(res.body.error.message).toBe("The request body is not valid");
    expect(JSON.stringify(res.body)).not.toContain("my-pc");
    expect(enroll).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const res = await request(build().app).post("/agent/v1/enroll").set("Content-Type", "text/plain").send("code=AB3D-7XQ2");
    expect(res.status).toBe(415);
  });

  it("answers every unusable code the same way (400 enrollment_code_invalid), so the answer is no oracle", async () => {
    const { app, enroll } = build();
    enroll.mockRejectedValue(new ApiFailure("enrollment_code_invalid", "That enrollment code is not valid."));
    const first = await request(app).post("/agent/v1/enroll").send(agentEnrollRequest);
    const second = await request(app).post("/agent/v1/enroll").send({ ...agentEnrollRequest, code: "ZZZZ-2222" });
    for (const res of [first, second]) {
      expect(res.status).toBe(400);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("enrollment_code_invalid");
    }
    expect(first.body.error.message).toBe(second.body.error.message);
  });

  it("is also limited across every caller, so a flood of distinct addresses cannot guess codes freely", async () => {
    const { app, enroll } = build({ globalEnrollLimiter: new UserRateLimiter({ max: 2, windowMs: 60_000 }) });
    expect((await request(app).post("/agent/v1/enroll").send(agentEnrollRequest)).status).toBe(201);
    expect((await request(app).post("/agent/v1/enroll").send(agentEnrollRequest)).status).toBe(201);
    expect((await request(app).post("/agent/v1/enroll").send(agentEnrollRequest)).status).toBe(429);
    expect(enroll).toHaveBeenCalledTimes(2);
  });

  it("is rate limited per client address (429 with Retry-After)", async () => {
    const { app, enroll } = build({ enrollLimiter: new UserRateLimiter({ max: 3, windowMs: 60_000 }) });
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post("/agent/v1/enroll").send(agentEnrollRequest)).status).toBe(201);
    }
    const res = await request(app).post("/agent/v1/enroll").send(agentEnrollRequest);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(enroll).toHaveBeenCalledTimes(3);
  });
});

describe("agent authentication", () => {
  it("a missing, malformed, unknown, revoked or removed-server credential is always the same 401 unauthorized", async () => {
    const { app, ingest } = build();
    const answers = await Promise.all([
      request(app).post("/agent/v1/snapshots").set("Content-Type", "application/json").send("{}"),
      request(app).post("/agent/v1/snapshots").set("Authorization", "Bearer short").set("Content-Type", "application/json").send("{}"),
      request(app).post("/agent/v1/snapshots").set("Authorization", `Basic ${SECRET}`).set("Content-Type", "application/json").send("{}"),
      postSnapshot(app, agentSnapshotRequestFull, "U".repeat(43)),
      postSnapshot(app, agentSnapshotRequestFull, REVOKED_SECRET),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("unauthorized");
    }
    expect(new Set(answers.map((res) => res.body.error.message)).size).toBe(1);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("is checked BEFORE the body is read: a wrong credential with a huge body is a 401, not a 413", async () => {
    const { app } = build({ snapshotMaxBytes: 1024 });
    const res = await request(app)
      .post("/agent/v1/snapshots")
      .set("Authorization", bearer("U".repeat(43)))
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ x: "a".repeat(10_000) }));
    expect(res.status).toBe(401);
  });

  it("a database outage is a 503, never a 401 (an agent that got 401 would ask its owner to re-enrol)", async () => {
    const { app } = build({ db: fakeDb({ down: true }) });
    const res = await postSnapshot(app);
    expect(res.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("service_unavailable");
  });

  it("writes last_seen_at at most once per 30 seconds per server", async () => {
    let nowMs = 1_000_000;
    const { app, database } = build({ now: () => nowMs });
    await postSnapshot(app);
    await postSnapshot(app);
    nowMs += 29_999;
    await postSnapshot(app);
    expect(database.touches).toHaveLength(1);
    nowMs += 1;
    await postSnapshot(app);
    expect(database.touches).toHaveLength(2);
  });

  it("never logs the credential (the request logger redacts the authorization header)", async () => {
    const lines: string[] = [];
    const { app } = build({ logWrite: (line) => lines.push(line) });
    await postSnapshot(app);
    await postSnapshot(app, agentSnapshotRequestFull, "U".repeat(43));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("U".repeat(43));
    }
  });
});

describe("POST /agent/v1/snapshots", () => {
  it("hands the snapshot to the server's agent-backed services and answers the cadence (200, the contract's shape)", async () => {
    const { app, ingest } = build({ now: () => 5_000_000 });
    const res = await postSnapshot(app);
    expect(res.status).toBe(200);
    expect(SnapshotResponseSchema.parse(res.body)).toEqual({ cadence: CADENCE, commandsPending: false });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]![0]).toMatchObject({ agentVersion: "0.1.0", reachable: true, paused: false });
    expect(ingest.mock.calls[0]![1]).toBe(5_000_000);
  });

  it("accepts an unreachable-game snapshot", async () => {
    const { app, ingest } = build();
    const res = await postSnapshot(app, agentSnapshotRequestUnreachable);
    expect(res.status).toBe(200);
    expect(ingest.mock.calls[0]![0]).toMatchObject({ reachable: false });
  });

  it("accepts a gzip-compressed body", async () => {
    const { app, ingest } = build();
    const res = await request(app)
      .post("/agent/v1/snapshots")
      .set("Authorization", bearer(SECRET))
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .serialize(rawBody)
      .send(gzipSync(Buffer.from(JSON.stringify(agentSnapshotRequestFull))));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  // The limit is on the DECOMPRESSED size: a few KB of gzip that inflate to megabytes must be refused.
  it("refuses a gzip bomb with 413 payload_too_large, whatever its compressed size", async () => {
    const { app, ingest } = build({ snapshotMaxBytes: 1024 * 1024 });
    const bomb = gzipSync(Buffer.from(`{"agentVersion":"0.1.0","padding":"${"a".repeat(6 * 1024 * 1024)}"}`));
    expect(bomb.length).toBeLessThan(64 * 1024);
    const res = await request(app)
      .post("/agent/v1/snapshots")
      .set("Authorization", bearer(SECRET))
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .serialize(rawBody)
      .send(bomb);
    expect(res.status).toBe(413);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("payload_too_large");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses an uncompressed body over the limit with 413 too", async () => {
    const { app } = build({ snapshotMaxBytes: 1024 });
    const res = await postSnapshot(app, { agentVersion: "0.1.0", padding: "a".repeat(5000) });
    expect(res.status).toBe(413);
  });

  it("takes a body just under the limit that inflates to exactly what it says", async () => {
    const body = JSON.stringify(agentSnapshotRequestFull);
    const { app } = build({ snapshotMaxBytes: Buffer.byteLength(body) });
    const res = await request(app)
      .post("/agent/v1/snapshots")
      .set("Authorization", bearer(SECRET))
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .serialize(rawBody)
      .send(gzipSync(Buffer.from(body)));
    expect(res.status).toBe(200);
  });

  it("refuses a body that fails its schema with a fixed message that never quotes what was sent (player names, ADR-0029)", async () => {
    const { app, ingest } = build();
    const res = await postSnapshot(app, { ...agentSnapshotRequestFull, players: { available: true, players: [{ name: "SecretPioneerName", online: "yes" }] } });
    expect(res.status).toBe(400);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("bad_request");
    expect(res.body.error.message).toBe("The snapshot is not valid");
    expect(JSON.stringify(res.body)).not.toContain("SecretPioneerName");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses an unreachable snapshot that still carries data parts", async () => {
    const { app } = build();
    const res = await postSnapshot(app, { ...agentSnapshotRequestFull, reachable: false });
    expect(res.status).toBe(400);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await request(build().app).post("/agent/v1/snapshots").set("Authorization", bearer(SECRET)).set("Content-Type", "text/plain").send("hello");
    expect(res.status).toBe(415);
  });

  it("is rate limited per credential (bursts are fine, a flood is a 429)", async () => {
    const { app, ingest } = build({ snapshotLimiter: new TokenBucketLimiter({ capacity: 2, refillPerSecond: 0.1, now: () => 0 }) });
    expect((await postSnapshot(app)).status).toBe(200);
    expect((await postSnapshot(app)).status).toBe(200);
    const res = await postSnapshot(app);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("10");
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("is a 503 until the servers are loaded, so the agent retries instead of losing readings", async () => {
    const { app, ingest } = build({ isReady: () => false });
    const res = await postSnapshot(app);
    expect(res.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("builds a missing agent-backed entry for a valid credential once, then serves the snapshot", async () => {
    const database = fakeDb();
    const ingest = vi.fn();
    const services: { telemetry: { agentIngest?: { ingest: typeof ingest } } } = { telemetry: {} };
    const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services }]);
    const attachAgentRuntime = vi.fn(async () => {
      services.telemetry.agentIngest = { ingest };
    });
    const app = createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      routers: [],
      agentRouters: [
        createAgentApiRouter({
          auth: createAgentAuth({ db: database.db }),
          enrollment: { enroll: vi.fn() },
          commands: agentCommandsStub(),
          directory: directory as never,
          attachAgentRuntime,
          recordVersion: async () => undefined,
          cadence: () => CADENCE,
        }),
      ],
    });
    expect((await postSnapshot(app)).status).toBe(200);
    expect((await postSnapshot(app)).status).toBe(200);
    expect(attachAgentRuntime).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("is a 503 when the entry cannot be built (the credential's server is not in this process)", async () => {
    const database = fakeDb();
    const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services: { telemetry: {} } }]);
    const attachAgentRuntime = vi.fn(async () => {
      throw new Error("nope");
    });
    const app = createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      routers: [],
      agentRouters: [
        createAgentApiRouter({
          auth: createAgentAuth({ db: database.db }),
          enrollment: { enroll: vi.fn() },
          commands: agentCommandsStub(),
          directory: directory as never,
          attachAgentRuntime,
          recordVersion: async () => undefined,
          cadence: () => CADENCE,
        }),
      ],
    });
    const res = await postSnapshot(app);
    expect(res.status).toBe(503);
    expect(attachAgentRuntime).toHaveBeenCalledTimes(1);
  });

  it("records the agent's version only when it changes", async () => {
    const { app, database } = build();
    await postSnapshot(app);
    await postSnapshot(app);
    await postSnapshot(app, { ...agentSnapshotRequestFull, agentVersion: "0.2.0" });
    expect(database.versions).toEqual(["0.1.0", "0.2.0"]);
  });
});

const COMMAND = { id: "6f1c0a52-9b1e-4c53-8a52-0d5d7e2f3a11", type: "set_auto_pause", params: { enabled: false }, expiresAt: "2026-09-26T12:01:00.000Z" };
const getCommands = (app: ReturnType<typeof build>["app"], query = "", secret = SECRET) =>
  request(app).get(`/agent/v1/commands${query}`).set("Authorization", bearer(secret));
const postResult = (app: ReturnType<typeof build>["app"], commandId: string, body: unknown, secret = SECRET) =>
  request(app).post(`/agent/v1/commands/${commandId}/result`).set("Authorization", bearer(secret)).set("Content-Type", "application/json").send(JSON.stringify(body));

describe("the snapshot answer's commandsPending (ADR-0031 PR 5b)", () => {
  it("tells the agent a command is waiting, so it calls GET /commands now", async () => {
    const { app, commands } = build();
    commands.hasPending.mockResolvedValue(true);
    const res = await postSnapshot(app);
    expect(SnapshotResponseSchema.parse(res.body)).toEqual({ cadence: CADENCE, commandsPending: true });
    expect(commands.hasPending).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("is false when nothing waits", async () => {
    expect((await postSnapshot(build().app)).body.commandsPending).toBe(false);
  });
});

describe("GET /agent/v1/commands (the long-poll)", () => {
  it("returns the server's commands in the contract's shape, asking for THIS credential's server only", async () => {
    const { app, commands } = build();
    commands.poll.mockResolvedValue([COMMAND]);
    const res = await getCommands(app);
    expect(res.status).toBe(200);
    expect(AgentCommandsResponseSchema.parse(res.body)).toEqual({ commands: [COMMAND] });
    expect(commands.poll.mock.calls[0]![0]).toEqual({ serverUuid: "11111111-1111-4111-8111-111111111111", publicId: "alpha" });
  });

  it("is an empty list, not an error, when the wait is up with nothing to do", async () => {
    const res = await getCommands(build().app, "?waitSeconds=3");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ commands: [] });
  });

  it("passes waitSeconds through (default 0) and refuses one out of range or not a number with a fixed 400", async () => {
    const { app, commands } = build();
    await getCommands(app);
    await getCommands(app, "?waitSeconds=25");
    expect(commands.poll.mock.calls.map((call) => call[1])).toEqual([0, 25]);
    for (const query of ["?waitSeconds=26", "?waitSeconds=-1", "?waitSeconds=abc", "?waitSeconds=1.5"]) {
      const res = await getCommands(app, query);
      expect(res.status, query).toBe(400);
      expect(res.body.error.message).toBe("The query is not valid");
    }
    expect(commands.poll).toHaveBeenCalledTimes(2);
  });

  it("needs the agent's credential: the same 401 as everywhere, and no poll is started", async () => {
    const { app, commands } = build();
    const res = await getCommands(app, "?waitSeconds=25", "U".repeat(43));
    expect(res.status).toBe(401);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("unauthorized");
    expect((await request(app).get("/agent/v1/commands")).status).toBe(401);
    expect(commands.poll).not.toHaveBeenCalled();
  });

  it("stops waiting when the agent hangs up (the poll's signal aborts)", async () => {
    const { app, commands } = build();
    let seen: AbortSignal | undefined;
    commands.poll.mockImplementation(
      (_agent, _wait, signal) =>
        new Promise((resolve) => {
          seen = signal;
          signal?.addEventListener("abort", () => resolve([]));
        }),
    );
    const pending = request(app).get("/agent/v1/commands?waitSeconds=25").set("Authorization", bearer(SECRET)).timeout({ response: 150 });
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
  });

  it("is rate limited per credential, on its own budget (snapshots don't use it up)", async () => {
    const { app } = build({
      commandsLimiter: new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0.01, now: () => 0 }),
      snapshotLimiter: new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0.01, now: () => 0 }),
    });
    expect((await postSnapshot(app)).status).toBe(200);
    expect((await getCommands(app)).status).toBe(200);
    const res = await getCommands(app);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("100");
  });

  it("holds one open poll per credential: a second one ends the first, which answers an empty list", async () => {
    const { app, commands } = build();
    const signals: AbortSignal[] = [];
    commands.poll.mockImplementation(
      (_agent, _wait, signal) =>
        new Promise((resolve) => {
          signals.push(signal!);
          signal?.addEventListener("abort", () => resolve([]));
          if (signals.length === 2) setTimeout(() => resolve([COMMAND]), 10);
        }),
    );
    const first = getCommands(app, "?waitSeconds=25").then((res) => res);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const second = await getCommands(app, "?waitSeconds=25");
    const ended = await first;
    expect(signals[0]!.aborted).toBe(true);
    expect(ended.status).toBe(200);
    expect(ended.body).toEqual({ commands: [] });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ commands: [COMMAND] });
  });

  it("a database outage is a 503 from the service", async () => {
    const { app, commands } = build();
    commands.poll.mockRejectedValue(new ServiceUnavailableError());
    expect((await getCommands(app)).status).toBe(503);
  });
});

describe("POST /agent/v1/commands/:commandId/result", () => {
  it("records the result and answers { accepted: true }", async () => {
    const { app, commands } = build();
    const ok = await postResult(app, COMMAND.id, { ok: true });
    expect(ok.status).toBe(200);
    expect(CommandResultResponseSchema.parse(ok.body)).toEqual({ accepted: true });
    const failed = await postResult(app, COMMAND.id, { ok: false, code: "upstream_unreachable" });
    expect(failed.status).toBe(200);
    expect(commands.report.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [COMMAND.id, { ok: true }],
      [COMMAND.id, { ok: false, code: "upstream_unreachable" }],
    ]);
    expect(commands.report.mock.calls[0]![0]).toMatchObject({ publicId: "alpha" });
  });

  it("an unknown command, or another server's, is the same 404 command_not_found", async () => {
    const { app, commands } = build();
    commands.report.mockRejectedValue(new ApiFailure("command_not_found", "No such command for this agent"));
    const res = await postResult(app, COMMAND.id, { ok: true });
    expect(res.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("command_not_found");
  });

  it("a command that expired before its result arrived is 409 command_expired", async () => {
    const { app, commands } = build();
    commands.report.mockRejectedValue(new ApiFailure("command_expired", "That command expired before its result arrived"));
    const res = await postResult(app, COMMAND.id, { ok: true });
    expect(res.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("command_expired");
  });

  it.each([
    ["free text (a game server's message could hold a token)", { ok: false, code: "upstream_error", message: "token=abc" }],
    ["a code that is not in the vocabulary", { ok: false, code: "nope" }],
    ["a code on a success", { ok: true, code: "upstream_error" }],
    ["a missing ok", { code: "upstream_error" }],
    ["ok that is not a boolean", { ok: "yes" }],
  ])("refuses %s with a fixed message that echoes nothing", async (_name, body) => {
    const { app, commands } = build();
    const res = await postResult(app, COMMAND.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("The result is not valid");
    expect(JSON.stringify(res.body)).not.toContain("token=abc");
    expect(commands.report).not.toHaveBeenCalled();
  });

  it("refuses a command id that is not a plausible id, and a body that is not JSON", async () => {
    const { app, commands } = build();
    expect((await postResult(app, "x".repeat(101), { ok: true })).status).toBe(400);
    const res = await request(app).post(`/agent/v1/commands/${COMMAND.id}/result`).set("Authorization", bearer(SECRET)).set("Content-Type", "text/plain").send("ok");
    expect(res.status).toBe(415);
    expect(commands.report).not.toHaveBeenCalled();
  });

  it("needs the agent's credential", async () => {
    const { app, commands } = build();
    expect((await postResult(app, COMMAND.id, { ok: true }, "U".repeat(43))).status).toBe(401);
    expect(commands.report).not.toHaveBeenCalled();
  });
});

describe("the rest of /agent", () => {
  it("answers an unknown path with the not_found envelope, and never leaks anything without a credential", async () => {
    const res = await request(build().app).get("/agent/v1/nothing-here");
    expect(res.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("not_found");
  });
});

describe("POST /agent/v1/snapshots records satis.agent.ingest.lag (ADR-0037 build step 3, fake clock)", () => {
  const RECEIVED_AT = Date.parse("2026-09-26T12:00:10.000Z");
  const lagOf = (metrics: ReturnType<typeof createMetricsAggregator>) =>
    metrics.drain().filter((delta) => delta.metric === "satis.agent.ingest.lag");

  it("records received-at minus the agent's observedAt, labelled with the server's public id", async () => {
    const metrics = createMetricsAggregator(() => RECEIVED_AT);
    const { app, ingest } = build({ now: () => RECEIVED_AT, metrics });
    const res = await postSnapshot(app, { ...agentSnapshotRequestFull, observedAt: "2026-09-26T12:00:07.500Z" });
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(lagOf(metrics)).toEqual([expect.objectContaining({ labels: { server: "alpha" }, count: 1, sum: 2500 })]);
  });

  it("reads an observedAt with an offset as the instant it names", async () => {
    const metrics = createMetricsAggregator(() => RECEIVED_AT);
    const { app } = build({ now: () => RECEIVED_AT, metrics });
    await postSnapshot(app, { ...agentSnapshotRequestFull, observedAt: "2026-09-26T14:00:09.000+02:00" });
    expect(lagOf(metrics)).toEqual([expect.objectContaining({ sum: 1000 })]);
  });

  it("clamps an observedAt in the future (an agent clock running ahead) to 0, never a negative lag", async () => {
    const metrics = createMetricsAggregator(() => RECEIVED_AT);
    const { app } = build({ now: () => RECEIVED_AT, metrics });
    await postSnapshot(app, { ...agentSnapshotRequestFull, observedAt: "2026-09-26T12:05:00.000Z" });
    const [delta] = lagOf(metrics);
    expect(delta).toMatchObject({ count: 1, sum: 0 });
    expect(delta?.bucketCounts?.[0]).toBe(1); // the lowest bucket, not a negative value
  });

  it("records nothing for a snapshot that is refused (invalid body, not ready)", async () => {
    const metrics = createMetricsAggregator(() => RECEIVED_AT);
    const invalid = build({ now: () => RECEIVED_AT, metrics });
    expect((await postSnapshot(invalid.app, { ...agentSnapshotRequestFull, observedAt: "not a time" })).status).toBe(400);
    const notReady = build({ now: () => RECEIVED_AT, metrics, isReady: () => false });
    expect((await postSnapshot(notReady.app)).status).toBe(503);
    expect(lagOf(metrics)).toEqual([]);
  });

  it("a metrics sink that throws never reaches the route: the snapshot is still ingested and answered 200, and it is logged once", async () => {
    const throwing: MetricsSink = {
      recordHistogram() {
        throw new Error("metrics broken");
      },
      recordCounter() {
        throw new Error("metrics broken");
      },
    };
    const warn = vi.fn();
    const { app, ingest } = build({ now: () => RECEIVED_AT, metrics: throwing, logger: { warn } as never });
    expect((await postSnapshot(app)).status).toBe(200);
    expect((await postSnapshot(app)).status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

const SNAPSHOT_BYTES = Buffer.byteLength(JSON.stringify(agentSnapshotRequestFull));
/** A byte budget that never refills within a test. */
const byteBudget = (capacity: number) => new TokenBucketLimiter({ capacity, refillPerSecond: 1, now: () => 0 });

describe("the per-credential snapshot byte budget (#514)", () => {
  it("allows snapshots while the budget is positive and refuses the next one with 429 and Retry-After (n allowed, n+1 refused)", async () => {
    const { app, ingest } = build({ snapshotByteBudget: byteBudget(2 * SNAPSHOT_BYTES) });
    expect((await postSnapshot(app)).status).toBe(200);
    expect((await postSnapshot(app)).status).toBe(200);
    const res = await postSnapshot(app);
    expect(res.status).toBe(429);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("rate_limited");
    expect(res.headers["retry-after"]).toBe("1");
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("charges the DECOMPRESSED size of a gzip body", async () => {
    // One byte more than one snapshot: by compressed size (about a third) a third snapshot would still fit.
    const { app, ingest } = build({ snapshotByteBudget: byteBudget(SNAPSHOT_BYTES + 1) });
    const gzipped = gzipSync(Buffer.from(JSON.stringify(agentSnapshotRequestFull)));
    const send = () =>
      request(app).post("/agent/v1/snapshots").set("Authorization", bearer(SECRET)).set("Content-Type", "application/json").set("Content-Encoding", "gzip").serialize(rawBody).send(gzipped);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200); // 1 byte left: still admitted, and now in debt
    expect((await send()).status).toBe(429);
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("refuses a credential in debt BEFORE its body is read: an oversized body is a 429, not a 413", async () => {
    const { app } = build({ snapshotByteBudget: byteBudget(100), snapshotMaxBytes: 1024 });
    expect((await postSnapshot(app)).status).toBe(413); // over the cap: charged the cap, so 100 - 1024 is in debt
    const res = await request(app).post("/agent/v1/snapshots").set("Authorization", bearer(SECRET)).set("Content-Type", "application/json").send(JSON.stringify({ x: "a".repeat(10_000) }));
    expect(res.status).toBe(429);
  });

  it("a gzip bomb is charged the cap it was inflated to", async () => {
    const { app } = build({ snapshotByteBudget: byteBudget(1024), snapshotMaxBytes: 1024 });
    const bomb = gzipSync(Buffer.from(JSON.stringify({ x: "a".repeat(100_000) })));
    const res = await request(app).post("/agent/v1/snapshots").set("Authorization", bearer(SECRET)).set("Content-Type", "application/json").set("Content-Encoding", "gzip").serialize(rawBody).send(bomb);
    expect(res.status).toBe(413);
    expect((await postSnapshot(app)).status).toBe(429);
  });

  it("is per credential: one server's debt never refuses another's", async () => {
    const budget = byteBudget(SNAPSHOT_BYTES);
    budget.charge("some-other-server", 10 * SNAPSHOT_BYTES);
    const { app } = build({ snapshotByteBudget: budget });
    expect((await postSnapshot(app)).status).toBe(200);
  });
});

/** A database whose one live credential can be revoked, and which can go down, mid-test. */
function switchableDb() {
  const base = fakeDb();
  const state = { revoked: false, down: false };
  const db: Queryable = {
    async query(text, values) {
      if (state.down) throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
      if (state.revoked && text.includes("secret_hash = $1")) return { rows: [] };
      return base.db.query(text, values);
    },
  };
  return { ...base, db, state };
}

describe("agent authentication's failure budgets can't lock out valid agents (#514, ADR-0045 E3)", () => {
  const from = (address: string) => ({ "CF-Connecting-IP": address });
  const junk = (app: ReturnType<typeof build>["app"], address: string) =>
    request(app).post("/agent/v1/snapshots").set(from(address)).set("Authorization", bearer("U".repeat(43))).set("Content-Type", "application/json").send("{}");
  const valid = (app: ReturnType<typeof build>["app"], address = "198.51.100.1") =>
    request(app).post("/agent/v1/snapshots").set(from(address)).set("Authorization", bearer(SECRET)).set("Content-Type", "application/json").send(JSON.stringify(agentSnapshotRequestFull));
  const buildWithAuth = (auth: { perNetwork?: number; global?: number }, database = fakeDb()) =>
    build({
      db: database,
      auth: createAgentAuth({
        db: database.db,
        now: () => 1_000_000,
        limiter: new UserRateLimiter({ max: auth.perNetwork ?? 1_000, windowMs: 60_000, now: () => 1_000_000 }),
        globalLimiter: new UserRateLimiter({ max: auth.global ?? 1_000, windowMs: 60_000, now: () => 1_000_000 }),
      }),
      snapshotLimiter: new TokenBucketLimiter({ capacity: 1_000, refillPerSecond: 1, now: () => 0 }),
    });

  it("junk from many addresses uses up the global failure budget, and a valid agent is still served", async () => {
    const { app, ingest } = buildWithAuth({ global: 5 });
    expect((await valid(app)).status).toBe(200);
    const answers = [];
    for (let i = 0; i < 20; i++) answers.push((await junk(app, `203.0.113.${i + 1}`)).status);
    expect(answers.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(new Set(answers.slice(5))).toEqual(new Set([429]));
    expect((await valid(app)).status).toBe(200);
    expect((await valid(app, "203.0.113.7")).status).toBe(200); // even from an address that sent junk
    expect(ingest).toHaveBeenCalledTimes(3);
  });

  it("successful requests never count: a valid agent may send far more than the failure budgets", async () => {
    const { app } = buildWithAuth({ perNetwork: 2, global: 2 });
    for (let i = 0; i < 10; i++) expect((await valid(app)).status).toBe(200);
    // The budgets are still whole for failures (n allowed, n+1 refused).
    expect((await junk(app, "198.51.100.1")).status).toBe(401);
    expect((await junk(app, "198.51.100.1")).status).toBe(401);
    expect((await junk(app, "198.51.100.1")).status).toBe(429);
  });

  it("the per-network failure budget refuses at its boundary, and only that network", async () => {
    const { app } = buildWithAuth({ perNetwork: 3 });
    for (let i = 0; i < 3; i++) expect((await junk(app, "203.0.113.9")).status).toBe(401);
    const res = await junk(app, "203.0.113.9");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect((await junk(app, "203.0.113.10")).status).toBe(401);
  });

  it("a missing or malformed credential counts as a failure too", async () => {
    const { app } = buildWithAuth({ perNetwork: 1 });
    expect((await request(app).post("/agent/v1/snapshots").set(from("203.0.113.5")).set("Content-Type", "application/json").send("{}")).status).toBe(401);
    expect((await request(app).post("/agent/v1/snapshots").set(from("203.0.113.5")).set("Authorization", "Bearer short").send("{}")).status).toBe(429);
  });

  it("a valid credential not seen before is refused while the flood lasts (it is not yet known to be valid), then served", async () => {
    let nowMs = 1_000_000;
    const database = fakeDb();
    const { app } = build({
      db: database,
      auth: createAgentAuth({ db: database.db, now: () => nowMs, globalLimiter: new UserRateLimiter({ max: 2, windowMs: 60_000, now: () => nowMs }) }),
    });
    await junk(app, "203.0.113.1");
    await junk(app, "203.0.113.2");
    expect((await valid(app)).status).toBe(429);
    nowMs += 60_000;
    expect((await valid(app)).status).toBe(200);
  });

  it("a recently valid credential that is then revoked is a 401 at once, and counts as a failure", async () => {
    const database = switchableDb();
    const { app } = buildWithAuth({ perNetwork: 1 }, database);
    expect((await valid(app)).status).toBe(200);
    database.state.revoked = true;
    expect((await valid(app)).status).toBe(401);
    expect((await valid(app)).status).toBe(429); // forgotten, so counted: the budget of 1 is used up
  });

  it("a database outage gives the attempt back: it never uses up the failure budgets", async () => {
    const database = switchableDb();
    const { app } = buildWithAuth({ perNetwork: 1, global: 1 }, database);
    database.state.down = true;
    for (let i = 0; i < 3; i++) expect((await valid(app)).status).toBe(503);
    database.state.down = false;
    expect((await valid(app)).status).toBe(200);
  });

  it("forgets a recently valid credential after the TTL, so it is counted again", async () => {
    let nowMs = 1_000_000;
    const database = fakeDb();
    const { app } = build({
      db: database,
      auth: createAgentAuth({
        db: database.db,
        now: () => nowMs,
        recentlyValidTtlMs: 1_000,
        globalLimiter: new UserRateLimiter({ max: 1, windowMs: 60_000, now: () => nowMs }),
      }),
    });
    expect((await valid(app)).status).toBe(200); // counted (not known yet), then refunded
    await junk(app, "203.0.113.1"); // uses up the global budget of 1
    expect((await valid(app)).status).toBe(200); // known: not checked
    nowMs += 1_000;
    expect((await valid(app)).status).toBe(429); // forgotten
  });
});

describe("satis.agent.refused counts refused agent requests by server and status (#514, ADR-0045 O4)", () => {
  const refusedOf = (metrics: ReturnType<typeof createMetricsAggregator>) =>
    metrics
      .drain()
      .filter((delta) => delta.metric === "satis.agent.refused")
      .map((delta) => ({ ...delta.labels, count: delta.count }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  it("labels a refusal before authentication 'unknown', and one after it with the server's public id", async () => {
    const metrics = createMetricsAggregator(() => 0);
    const { app } = build({ metrics, snapshotMaxBytes: 1024, snapshotLimiter: new TokenBucketLimiter({ capacity: 3, refillPerSecond: 0.01, now: () => 0 }) });
    await postSnapshot(app, agentSnapshotRequestFull, "U".repeat(43)); // 401, unknown
    await postSnapshot(app); // 413 (over 1 kB), alpha
    await postSnapshot(app, { bad: true }); // 400, alpha
    await request(app).post("/agent/v1/snapshots").set("Authorization", bearer(SECRET)).set("Content-Type", "text/plain").send("x"); // 415, alpha
    await postSnapshot(app); // 429, alpha (the bucket of 3 is spent)
    await waitForFinish();
    expect(refusedOf(metrics)).toEqual(
      [
        { server: "alpha", status: "400", count: 1 },
        { server: "alpha", status: "413", count: 1 },
        { server: "alpha", status: "415", count: 1 },
        { server: "alpha", status: "429", count: 1 },
        { server: "unknown", status: "401", count: 1 },
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  });

  it("counts nothing for a served request, and never a body or credential in its labels", async () => {
    const metrics = createMetricsAggregator(() => 0);
    const { app } = build({ metrics });
    expect((await postSnapshot(app)).status).toBe(200);
    await waitForFinish();
    expect(refusedOf(metrics)).toEqual([]);
  });
});

/** `finish` fires after the response is flushed, which can be just after Supertest resolves. */
const waitForFinish = () => new Promise((resolve) => setTimeout(resolve, 20));
