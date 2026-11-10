import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretsKeyring, type SecretsKeyring } from "../../../platform/secrets/secrets.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { pushFieldContext } from "../services/pushSender.js";
import { webhookContext } from "./deliveryRepository.js";
import { checkStoredSecrets } from "./secretsCheck.js";

// No SQL runs here (the statements run against Postgres in secretsCheck.db.test.ts): a fake Queryable serves rows sealed
// the way the writers seal them (saveDiscordDestination, the push service), so a change to either context fails here.

const SERVER = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const WEBHOOK = "https://discord.com/api/webhooks/123/abcdef";

const newRing = (id = "k1", key = randomBytes(32)) => createSecretsKeyring(id, new Map([[id, key]]));

function destinationRow(ring: SecretsKeyring, id = "d1", serverUuid = SERVER) {
  const sealed = ring.seal(WEBHOOK, webhookContext(serverUuid));
  return { id, server_uuid: serverUuid, key_id: sealed.keyId, webhook_enc: sealed.data };
}

function subscriptionRow(ring: SecretsKeyring, id = "s1", userId = USER) {
  const endpoint = ring.seal("https://fcm.googleapis.com/fcm/send/x", pushFieldContext(userId, "endpoint"));
  const p256dh = ring.seal("p256dh-value", pushFieldContext(userId, "p256dh"));
  const auth = ring.seal("auth-value", pushFieldContext(userId, "auth"));
  return { id, user_id: userId, key_id: endpoint.keyId, endpoint_enc: endpoint.data, p256dh_enc: p256dh.data, auth_enc: auth.data };
}

const servingDb = (destinations: unknown[], subscriptions: unknown[]): Queryable => ({
  query: async (text: string) => ({ rows: text.includes("alerts.destinations") ? destinations : subscriptions }),
});

describe("checkStoredSecrets (verify-secrets, ADR-0066 PR 10a)", () => {
  it("opens every webhook and push subscription the ring sealed", async () => {
    const ring = newRing();
    const check = await checkStoredSecrets(servingDb([destinationRow(ring), destinationRow(ring, "d2")], [subscriptionRow(ring)]), ring);
    expect(check).toEqual({ destinations: { opened: 2, unreadable: [] }, pushSubscriptions: { opened: 1, unreadable: [] } });
  });

  it("reports rows another key sealed by id and key id only, never a value", async () => {
    const ring = newRing("k1");
    const other = newRing("k2");
    const check = await checkStoredSecrets(servingDb([destinationRow(other, "d9")], [subscriptionRow(other, "s9"), subscriptionRow(ring)]), ring);
    expect(check.destinations).toEqual({ opened: 0, unreadable: [{ id: "d9", keyId: "k2" }] });
    expect(check.pushSubscriptions).toEqual({ opened: 1, unreadable: [{ id: "s9", keyId: "k2" }] });
    expect(JSON.stringify(check)).not.toContain("discord.com");
  });

  it("a row sealed for another server or user does not open (the context binds it)", async () => {
    const ring = newRing();
    const moved = { ...destinationRow(ring), server_uuid: "33333333-3333-4333-8333-333333333333" };
    const swapped = { ...subscriptionRow(ring), user_id: "44444444-4444-4444-8444-444444444444" };
    const check = await checkStoredSecrets(servingDb([moved], [swapped]), ring);
    expect(check.destinations.opened).toBe(0);
    expect(check.pushSubscriptions.opened).toBe(0);
  });

  it("with no ring, nothing opens and every row is reported", async () => {
    const ring = newRing();
    const check = await checkStoredSecrets(servingDb([destinationRow(ring)], [subscriptionRow(ring)]), null);
    expect(check.destinations.unreadable).toHaveLength(1);
    expect(check.pushSubscriptions.unreadable).toHaveLength(1);
  });

  it("is empty when nothing is sealed", async () => {
    expect(await checkStoredSecrets(servingDb([], []), newRing())).toEqual({
      destinations: { opened: 0, unreadable: [] },
      pushSubscriptions: { opened: 0, unreadable: [] },
    });
  });

  it("refuses a row of the wrong shape", async () => {
    await expect(checkStoredSecrets(servingDb([{ id: "d1" }], []), newRing())).rejects.toThrow("Unexpected database row shape");
  });
});
