import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { webhookContext } from "../repositories/deliveryRepository.js";
import { sendAlertTest } from "./sendTest.js";

const SERVER_UUID = "11111111-1111-4111-8111-111111111111";
const DEST = "22222222-2222-4222-8222-222222222222";
const URL_OK = `https://discord.com/api/webhooks/1234567890123456789/${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz012345"}`;
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

/** A database with (at most) one destination row; records the statements it saw. */
function fakeDb(destination: { enabled: boolean; sealedFor?: string } | undefined) {
  const seen: string[] = [];
  const sealed = ring.seal(URL_OK, webhookContext(destination?.sealedFor ?? SERVER_UUID));
  const handle = (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.includes("d.last4 AS last4")) {
      seen.push("summary");
      return { rows: destination ? [{ id: DEST, enabled: destination.enabled, last4: "z012", disabled_reason: destination.enabled ? null : "manual" }] : [] };
    }
    if (sql.includes("d.webhook_enc AS webhook_enc")) {
      seen.push("sealed");
      return { rows: destination ? [{ id: DEST, server_uuid: SERVER_UUID, webhook_enc: sealed.data, key_id: sealed.keyId, enabled: destination.enabled }] : [] };
    }
    if (sql.includes("UPDATE alerts.destinations SET enabled = false")) {
      seen.push("disable");
      return { rows: [] };
    }
    if (sql.includes("UPDATE alerts.outbox SET status = 'dead'")) {
      seen.push("deadForDestination");
      return { rows: [] };
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
  };
  const client = { on: () => {}, removeListener: () => {}, release: () => {}, query: async (sql: string) => handle(sql) };
  return { db: { query: async (sql: string) => handle(sql), connect: async () => client } as never, seen };
}

const respond = (status: number, init: { headers?: Record<string, string> } = {}) => vi.fn(async () => new Response(null, { status, headers: init.headers }));
const run = (mode: "on" | "off", destination: Parameters<typeof fakeDb>[0], fetchMock: ReturnType<typeof respond>) => {
  const fake = fakeDb(destination);
  return sendAlertTest({ mode, db: fake.db, ring, serverPublicId: "alpha", serverName: "Home", fetch: fetchMock as never }).then((result) => ({ result, fake }));
};

describe("sendAlertTest (the rules API's Send test, PR 7)", () => {
  it("with ALERT_DELIVERY off it sends NOTHING and answers delivery_off, without even reading the destination", async () => {
    const fetchMock = respond(204);
    const { result, fake } = await run("off", { enabled: true }, fetchMock);
    expect(result).toEqual({ code: "delivery_off" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.seen).toEqual([]);
  });

  it("with it on, sends one test message to the destination's webhook and answers sent", async () => {
    const fetchMock = respond(204);
    const { result } = await run("on", { enabled: true }, fetchMock);
    expect(result).toEqual({ code: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.redirect).toBe("manual");
    const payload = JSON.parse(init.body as string);
    expect(payload.embeds[0].title).toBe("Test message");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("answers no_destination and destination_disabled without sending", async () => {
    const fetchMock = respond(204);
    expect((await run("on", undefined, fetchMock)).result).toEqual({ code: "no_destination" });
    expect((await run("on", { enabled: false }, fetchMock)).result).toEqual({ code: "destination_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a stored webhook that cannot be opened (copied from another server) is secret_unreadable and is never sent", async () => {
    const fetchMock = respond(204);
    const { result } = await run("on", { enabled: true, sealedFor: "99999999-9999-4999-8999-999999999999" }, fetchMock);
    expect(result).toEqual({ code: "secret_unreadable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 404 disables the destination (and its pending deliveries) and says webhook_gone", async () => {
    const { result, fake } = await run("on", { enabled: true }, respond(404));
    expect(result).toEqual({ code: "webhook_gone" });
    expect(fake.seen).toEqual(expect.arrayContaining(["disable", "deadForDestination"]));
  });

  it("maps a rate limit, an outage and a refusal to their codes, and a redirect is refused", async () => {
    expect((await run("on", { enabled: true }, respond(429, { headers: { "retry-after": "5" } }))).result).toEqual({ code: "rate_limited" });
    expect((await run("on", { enabled: true }, respond(503))).result).toEqual({ code: "unavailable" });
    expect((await run("on", { enabled: true }, respond(400))).result).toEqual({ code: "rejected" });
    const redirect = respond(302, { headers: { location: "http://169.254.169.254/" } });
    expect((await run("on", { enabled: true }, redirect)).result).toEqual({ code: "rejected" });
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("the answer never carries the URL or its token", async () => {
    for (const status of [204, 302, 400, 404, 429, 500]) {
      const { result } = await run("on", { enabled: true }, respond(status));
      expect(JSON.stringify(result), String(status)).not.toContain("webhooks");
      expect(JSON.stringify(result), String(status)).not.toContain("AbCdEf");
    }
  });
});
