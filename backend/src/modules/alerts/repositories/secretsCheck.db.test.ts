import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { createUser } from "../../identity/repositories/userRepository.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { pushFieldContext } from "../services/pushSender.js";
import { webhookContext } from "./deliveryRepository.js";
import { checkStoredSecrets } from "./secretsCheck.js";

const available = dbTestsAvailable();

// ADR-0066 PR 10a: the `verify-secrets` statements run as satis_app (the role the admin command connects as) against
// every migration, rows sealed as the writers seal them.
describe.skipIf(!available)("checkStoredSecrets against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  const k1 = randomBytes(32);
  const ringK1 = createSecretsKeyring("k1", new Map([["k1", k1]]));
  const ringK2 = createSecretsKeyring("k2", new Map([["k2", randomBytes(32)]]));

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  it("is empty with nothing sealed, then opens a stored webhook and push subscription, and reports what another key sealed", async () => {
    expect(await checkStoredSecrets(pool, ringK1)).toEqual({ destinations: { opened: 0, unreadable: [] }, pushSubscriptions: { opened: 0, unreadable: [] } });

    const server = await upsertConfiguredServer(pool, { publicId: "secrets-check", displayName: "Secrets" });
    const user = await createUser(pool, { displayName: "push user" });
    const webhook = ringK1.seal("https://discord.com/api/webhooks/1/abc", webhookContext(server.id));
    await admin.query("INSERT INTO alerts.destinations (server_id, kind, webhook_enc, key_id, last4) VALUES ($1, 'discord', $2, $3, 'xabc')", [
      server.id,
      webhook.data,
      webhook.keyId,
    ]);
    const seal = (ring: typeof ringK1, field: "endpoint" | "p256dh" | "auth", value: string) => ring.seal(value, pushFieldContext(user.id, field)).data;
    const insertSubscription = (ring: typeof ringK1, keyId: string, endpoint: string) =>
      admin.query(
        `INSERT INTO alerts.push_subscriptions (user_id, endpoint_enc, p256dh_enc, auth_enc, key_id, endpoint_host, endpoint_hash)
         VALUES ($1, $2, $3, $4, $5, 'fcm.googleapis.com', $6) RETURNING id::text AS id`,
        [user.id, seal(ring, "endpoint", endpoint), seal(ring, "p256dh", "p"), seal(ring, "auth", "a"), keyId, createHash("sha256").update(endpoint).digest()],
      );
    await insertSubscription(ringK1, "k1", "https://fcm.googleapis.com/fcm/send/one");
    const foreign = (await insertSubscription(ringK2, "k2", "https://fcm.googleapis.com/fcm/send/two")).rows[0].id as string;

    const check = await checkStoredSecrets(pool, ringK1);
    expect(check.destinations).toEqual({ opened: 1, unreadable: [] });
    expect(check.pushSubscriptions).toEqual({ opened: 1, unreadable: [{ id: foreign, keyId: "k2" }] });
  });
});
