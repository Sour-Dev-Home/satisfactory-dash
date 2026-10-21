import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { listRules, seedPresetRules, writeEvaluation } from "./alertRepository.js";
import { claimDueDeliveries, rescheduleDelivery, saveDiscordDestination } from "./deliveryRepository.js";

const available = dbTestsAvailable();
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const url = (n: number) => `https://discord.com/api/webhooks/${1234567890123456000n + BigInt(n)}/${TOKEN}`;
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

// #515 test-hunter: the round-robin claim under concurrency and with retry-delayed rows.
describe.skipIf(!available)("outbox claim: concurrency and retries (real Postgres)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const flood = async (n: number) => {
    const server = await upsertConfiguredServer(pool, { publicId: `cc-${++counter}`, displayName: "C" });
    await seedPresetRules(pool, server.publicId);
    await saveDiscordDestination(pool, ring, server.publicId, url(counter));
    const rule = (await listRules(pool)).find((r) => r.server_public_id === server.publicId && r.kind === "power_outage")!;
    await writeEvaluation(pool, {
      nowMs: Date.now(),
      deliver: true,
      writes: [],
      events: Array.from({ length: n }, (_, i) => ({ ruleId: rule.id, kind: "power_outage" as const, severity: "critical" as const, subject: `circuit:${i + 1}`, transition: "fired" as const, summary: { circuit: i + 1 } })),
    });
    return server;
  };

  it("two simultaneous claims never take the same row and together take everything due", async () => {
    await claimDueDeliveries(pool, 100_000, 3600);
    await flood(30);
    await flood(30);
    const [a, b] = await Promise.all([claimDueDeliveries(pool, 20, 120), claimDueDeliveries(pool, 20, 120)]);
    const ids = [...a, ...b].map((c) => c.outboxId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(40);
  });

  it("a server with only retry-delayed rows takes no slot from a server that is due", async () => {
    await claimDueDeliveries(pool, 100_000, 3600);
    const delayed = await flood(3);
    const first = await claimDueDeliveries(pool, 3, 120);
    for (const row of first) await rescheduleDelivery(pool, row.outboxId, Date.now() + 3_600_000, "x");
    const due = await flood(5);
    const claimed = await claimDueDeliveries(pool, 5, 120);
    expect(claimed.map((c) => c.serverPublicId)).toEqual(Array(5).fill(due.publicId));
    expect(claimed.some((c) => c.serverPublicId === delayed.publicId)).toBe(false);
  });
});
