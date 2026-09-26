import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ApiErrorResponseSchema, EnrollResponseSchema, SnapshotResponseSchema } from "@satisfactory-dash/shared";
import { agentEnrollRequest, agentEnrollResponse, agentSnapshotRequestFull, agentSnapshotRequestUnreachable } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { ApiFailure } from "../../../platform/errorResponse.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { sha256 } from "../repositories/agentRepository.js";
import { createAgentAuth } from "../services/agentAuth.js";
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
  const app = createApp({
    logger: createLogger({ level: overrides.logWrite ? "info" : "silent" }, { write: overrides.logWrite ?? (() => {}) }),
    routers: [],
    agentRouters: [
      createAgentApiRouter({
        auth: createAgentAuth({ db: database.db, now }),
        enrollment: { enroll },
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
  return { app, ingest, enroll, attachAgentRuntime, database, directory };
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
    const { app, ingest } = build({ snapshotLimiter: new UserRateLimiter({ max: 2, windowMs: 10_000 }) });
    expect((await postSnapshot(app)).status).toBe(200);
    expect((await postSnapshot(app)).status).toBe(200);
    const res = await postSnapshot(app);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
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

describe("the rest of /agent", () => {
  it("answers an unknown path with the not_found envelope, and never leaks anything without a credential", async () => {
    const res = await request(build().app).get("/agent/v1/nothing-here");
    expect(res.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("not_found");
  });
});
