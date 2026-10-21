import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { agentSnapshotRequestFull } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { TokenBucketLimiter } from "../../../platform/tokenBucket.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { sha256 } from "../repositories/agentRepository.js";
import { createAgentAuth } from "../services/agentAuth.js";
import { rateLimitKey } from "../services/clientKey.js";
import type { AgentCommandsService } from "../services/commandsService.js";
import { createAgentApiRouter } from "./agentApi.js";

const SECRET = "S".repeat(43);
const SERVER_UUID = "11111111-1111-4111-8111-111111111111";
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

const db: Queryable = {
  async query(text, values = []) {
    if (text.includes("secret_hash = $1")) {
      return { rows: (values[0] as Buffer).equals(sha256(SECRET)) ? [{ server_id: SERVER_UUID, public_id: "alpha" }] : [] };
    }
    return { rows: [] };
  },
};

function build(overrides: Partial<Parameters<typeof createAgentApiRouter>[0]> = {}) {
  const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services: { telemetry: { agentIngest: { ingest: vi.fn() } } } }]);
  const commands = {
    poll: vi.fn<AgentCommandsService["poll"]>(async () => []),
    report: vi.fn<AgentCommandsService["report"]>(async () => undefined),
    hasPending: vi.fn<AgentCommandsService["hasPending"]>(async () => false),
  };
  const app = createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    agentRouters: [
      createAgentApiRouter({
        auth: createAgentAuth({ db, now: () => 1_000_000 }),
        enrollment: { enroll: vi.fn() } as never,
        commands,
        directory: directory as never,
        attachAgentRuntime: async () => undefined,
        recordVersion: async () => undefined,
        cadence: () => CADENCE,
        now: () => 1_000_000,
        ...overrides,
      }),
    ],
  });
  return { app, commands };
}

describe("agent auth: a refusal by one network must not spend the process-wide budget (#514)", () => {
  it("one address hammering past its own limit leaves the global failure budget for everyone else", async () => {
    const limiter = new UserRateLimiter({ max: 2, windowMs: 60_000, now: () => 1_000_000 });
    const globalLimiter = new UserRateLimiter({ max: 10, windowMs: 60_000, now: () => 1_000_000 });
    const { app } = build({ auth: createAgentAuth({ db, now: () => 1_000_000, limiter, globalLimiter }) });
    const junk = (ip: string) =>
      request(app).post("/agent/v1/snapshots").set("CF-Connecting-IP", ip).set("Authorization", `Bearer ${"U".repeat(43)}`).set("Content-Type", "application/json").send("{}");
    for (let i = 0; i < 50; i++) await junk("203.0.113.1"); // 2 reach the lookup, 48 are refused by their own network
    expect((await junk("203.0.113.2")).status).toBe(401); // another network still gets its (counted) failure
    // A valid agent not yet remembered (for example after a restart) still gets in.
    const ok = await request(app)
      .post("/agent/v1/snapshots").set("CF-Connecting-IP", "198.51.100.9").set("Authorization", `Bearer ${SECRET}`).set("Content-Type", "application/json")
      .send(JSON.stringify(agentSnapshotRequestFull));
    expect(ok.status).toBe(200);
  });
});

describe("rateLimitKey groups an IPv4 client under one key however it is written (#514)", () => {
  const key = (peer: string) => rateLimitKey({ socket: { remoteAddress: peer }, headers: {} } as never);
  it("an IPv4-mapped IPv6 peer is the same key as the plain IPv4 address", () => {
    expect(key("::ffff:203.0.113.5")).toBe(key("203.0.113.5"));
  });
  it("the long spelling of a mapped address is not lumped into one /64 with every other mapped client", () => {
    expect(key("0:0:0:0:0:ffff:203.0.113.5")).not.toBe(key("0:0:0:0:0:ffff:203.0.113.6"));
  });
});

describe("snapshot byte budget", () => {
  it("a truncated gzip body that inflated before failing is charged", async () => {
    const byteBudget = new TokenBucketLimiter({ capacity: 10 * 1024 * 1024, refillPerSecond: 1, now: () => 0 });
    const { app } = build({ snapshotByteBudget: byteBudget });
    const full = gzipSync(Buffer.alloc(4 * 1024 * 1024, 0x20));
    const bad = full.subarray(0, full.length - 8); // missing the trailer: inflates fully, then fails
    const res = await request(app)
      .post("/agent/v1/snapshots").set("Authorization", `Bearer ${SECRET}`).set("Content-Type", "application/json").set("Content-Encoding", "gzip")
      .send(bad as unknown as string);
    expect(res.status).toBe(400);
    // 6 MB should be left if the 4 MB of inflation was charged; 10 MB if not.
    expect(byteBudget.take(SERVER_UUID, 7 * 1024 * 1024)).toBeGreaterThan(0);
  });
});

describe("the long-poll supersede path", () => {
  it("a second poll ends the first with an empty list, and the second still receives the command", async () => {
    const { app, commands } = build({ commandsLimiter: new TokenBucketLimiter({ capacity: 100, refillPerSecond: 1, now: () => 0 }) });
    commands.poll.mockImplementationOnce((_a, _w, signal) => new Promise((resolve) => signal?.addEventListener("abort", () => resolve([]))));
    commands.poll.mockImplementationOnce(async () => [{ id: "c1", type: "set_auto_pause", params: { enabled: true }, expiresAt: new Date(2_000_000).toISOString() }] as never);
    const get = () => request(app).get("/agent/v1/commands?waitSeconds=25").set("Authorization", `Bearer ${SECRET}`);
    const first = get().then((r) => r);
    await new Promise((r) => setTimeout(r, 100));
    const second = await get();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.commands).toEqual([]);
    expect(second.body.commands).toHaveLength(1);
  });
});
