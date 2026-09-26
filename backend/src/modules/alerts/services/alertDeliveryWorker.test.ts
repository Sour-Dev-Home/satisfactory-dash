import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { webhookContext } from "../repositories/deliveryRepository.js";
import { AlertDeliveryWorker, type DeliveryDb } from "./alertDeliveryWorker.js";
import { DEAD_AFTER_MS, BASE_DELAY_MS } from "./retryPolicy.js";

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const SERVER_UUID = "11111111-1111-4111-8111-111111111111";
const DEST = "22222222-2222-4222-8222-222222222222";
const ID = "1234567890123456789";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const URL_OK = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
const otherRing = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

const sealed = (url = URL_OK, serverUuid = SERVER_UUID, keyring = ring) => keyring.seal(url, webhookContext(serverUuid));

interface Due {
  outbox_id: string;
  attempts: number;
  created_ms: number;
  destination_id: string;
  webhook_enc: Buffer;
  key_id: string;
  server_uuid: string;
  server_public_id: string;
  server_name: string;
  kind: string;
  severity: string;
  subject: string;
  transition: string;
  at_ms: number;
  summary: Record<string, unknown>;
}

const due = (id: string, over: Partial<Due> = {}): Due => {
  const s = sealed();
  return {
    outbox_id: id,
    attempts: 1,
    created_ms: NOW - 60_000,
    destination_id: DEST,
    webhook_enc: s.data,
    key_id: s.keyId,
    server_uuid: SERVER_UUID,
    server_public_id: "alpha",
    server_name: "Home",
    kind: "power_outage",
    severity: "critical",
    subject: "circuit:1",
    transition: "fired",
    at_ms: NOW,
    summary: { circuit: 1 },
    ...over,
  };
};

/** A fake database that hands out the configured due rows once and records every outbox statement. */
function fakeDb(rows: Due[]) {
  const outbox = new Map<string, { status: string; error?: string; at?: number }>();
  const calls: { kind: string; params: unknown[] }[] = [];
  let handed = false;
  const failClaim = { on: false };
  const handle = (sql: string, params: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.includes("WITH due AS")) {
      calls.push({ kind: "claim", params });
      if (failClaim.on) throw new Error("db down");
      if (handed) return { rows: [] };
      handed = true;
      return { rows };
    }
    if (sql.includes("SET status = 'sent'")) {
      calls.push({ kind: "sent", params });
      outbox.set(params[0] as string, { status: "sent" });
      return { rows: [] };
    }
    if (sql.includes("SET next_attempt_at = to_timestamp")) {
      calls.push({ kind: "reschedule", params });
      outbox.set(params[0] as string, { status: "pending", error: params[2] as string, at: params[1] as number });
      return { rows: [] };
    }
    if (sql.includes("SET status = 'dead', last_error = $2 WHERE id")) {
      calls.push({ kind: "dead", params });
      outbox.set(params[0] as string, { status: "dead", error: params[1] as string });
      return { rows: [] };
    }
    if (sql.includes("UPDATE alerts.destinations SET enabled = false")) {
      calls.push({ kind: "disable", params });
      return { rows: [] };
    }
    if (sql.includes("WHERE destination_id = $1::uuid AND status = 'pending'")) {
      calls.push({ kind: "deadForDestination", params });
      return { rows: [] };
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
  };
  const client = { on: () => {}, removeListener: () => {}, release: () => {}, query: async (sql: string, params?: unknown[]) => handle(sql, params) };
  const db = { query: async (sql: string, params?: unknown[]) => handle(sql, params), connect: async () => client } as unknown as DeliveryDb;
  return { db, outbox, calls, failClaim, of: (kind: string) => calls.filter((c) => c.kind === kind) };
}

const captureLogs = () => {
  const lines: unknown[] = [];
  const make = () => (obj: unknown, msg?: string) => lines.push({ obj, msg });
  return { logger: { info: make(), warn: make(), error: make() } as unknown as Logger, lines };
};

const respond = (status: number, init: { headers?: Record<string, string>; body?: string } = {}) =>
  vi.fn(async () => new Response(init.body ?? null, { status, headers: init.headers }));

const make = (rows: Due[], fetchMock: ReturnType<typeof respond>, keyring = ring) => {
  const fake = fakeDb(rows);
  const logs = captureLogs();
  const worker = new AlertDeliveryWorker(fake.db, keyring, { logger: logs.logger, fetch: fetchMock as never, now: () => NOW });
  return { fake, logs, worker, fetchMock };
};

describe("AlertDeliveryWorker.tick", () => {
  it("sends a due delivery to Discord, marks it sent, and the message is the formatted alert", async () => {
    const { fake, worker, fetchMock } = make([due("1")], respond(204));
    await worker.tick();
    expect(fake.outbox.get("1")).toEqual({ status: "sent" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.redirect).toBe("manual");
    const payload = JSON.parse(init.body as string);
    expect(payload.embeds[0].title).toBe("Power outage: circuit 1");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("uses the right words for the unreachable alert: Game server or FRM not responding", async () => {
    const { worker, fetchMock } = make([due("1", { kind: "server_unreachable", subject: "server", summary: { failedPolls: 30, downForSeconds: 150 } })], respond(204));
    await worker.tick();
    const payload = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(payload.embeds[0].title).toBe("Game server or FRM not responding");
  });

  it("a redirect is never followed: one request, the row is dead", async () => {
    const { fake, worker, fetchMock } = make([due("1")], respond(302, { headers: { location: "http://169.254.169.254/" } }));
    await worker.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.outbox.get("1")).toEqual({ status: "dead", error: "redirect_refused" });
  });

  it("a 5xx is retried later with exponential backoff (attempt 3 waits four times the base)", async () => {
    const { fake, worker } = make([due("1", { attempts: 3 })], respond(503));
    await worker.tick();
    expect(fake.outbox.get("1")).toEqual({ status: "pending", error: "server_error", at: NOW + BASE_DELAY_MS * 4 });
  });

  it("a network error is retried, and the log never contains the webhook URL", async () => {
    const boom = vi.fn(async () => {
      throw new TypeError(`fetch failed ${URL_OK}`);
    });
    const { fake, worker, logs } = make([due("1")], boom as never);
    await worker.tick();
    expect(fake.outbox.get("1")).toMatchObject({ status: "pending", error: "network" });
    expect(JSON.stringify(logs.lines)).not.toContain(TOKEN);
  });

  it("a 429 honours retry_after (never sooner) and pauses the rest of that destination for the tick", async () => {
    const rows = [due("1"), due("2"), due("3")];
    const { fake, worker, fetchMock } = make(rows, respond(429, { headers: { "retry-after": "600" } }));
    await worker.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the other two are not attempted against a rate-limited destination
    expect(fake.outbox.get("1")).toEqual({ status: "pending", error: "rate_limited", at: NOW + 600_000 });
    expect(fake.outbox.has("2")).toBe(false);
  });

  it("a 404 disables the destination and gives up on its pending deliveries (once, then stops sending to it)", async () => {
    const rows = [due("1"), due("2")];
    const { fake, worker, fetchMock, logs } = make(rows, respond(404));
    await worker.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.of("disable")).toEqual([{ kind: "disable", params: [DEST, "webhook_gone"] }]);
    expect(fake.of("deadForDestination")).toEqual([{ kind: "deadForDestination", params: [DEST, "webhook_gone"] }]);
    expect(JSON.stringify(logs.lines)).toContain("ALERT_DESTINATION_DISABLED");
    expect(JSON.stringify(logs.lines)).not.toContain(TOKEN);
  });

  it("a 401 (token no longer valid) disables it too", async () => {
    const { fake, worker } = make([due("1")], respond(401));
    await worker.tick();
    expect(fake.of("disable")).toHaveLength(1);
  });

  it("a 400 is dead for good without disabling the destination", async () => {
    const { fake, worker } = make([due("1")], respond(400));
    await worker.tick();
    expect(fake.outbox.get("1")).toEqual({ status: "dead", error: "bad_request" });
    expect(fake.of("disable")).toHaveLength(0);
  });

  it("gives up after 24 hours without sending (expired), and also when the next try would be past 24 hours", async () => {
    const old = make([due("1", { created_ms: NOW - DEAD_AFTER_MS })], respond(204));
    await old.worker.tick();
    expect(old.fake.outbox.get("1")).toEqual({ status: "dead", error: "expired" });
    expect(old.fetchMock).not.toHaveBeenCalled();
    const nearly = make([due("2", { created_ms: NOW - DEAD_AFTER_MS + 1000, attempts: 1 })], respond(503));
    await nearly.worker.tick();
    expect(nearly.fake.outbox.get("2")).toEqual({ status: "dead", error: "expired" }); // the retry would land past the limit
  });

  it("a stored webhook that cannot be opened (wrong key, or copied to another server) is never sent, and is retried later", async () => {
    const wrongKey = sealed(URL_OK, SERVER_UUID, otherRing);
    const otherServer = sealed(URL_OK, "99999999-9999-4999-8999-999999999999");
    for (const row of [due("1", { webhook_enc: wrongKey.data }), due("2", { webhook_enc: otherServer.data })]) {
      const { fake, worker, fetchMock, logs } = make([row], respond(204));
      await worker.tick();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.outbox.get(row.outbox_id)).toMatchObject({ status: "pending", error: "secret_unreadable" });
      expect(JSON.stringify(logs.lines)).toContain("ALERT_DESTINATION_UNREADABLE");
    }
  });

  it("a stored URL that no longer passes the allowlist is never fetched", async () => {
    const tampered = sealed("https://evil.example/api/webhooks/1234567890123456789/" + TOKEN);
    const { fake, worker, fetchMock } = make([due("1", { webhook_enc: tampered.data })], respond(204));
    await worker.tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.outbox.get("1")).toEqual({ status: "dead", error: "invalid_url" });
  });

  it("no log line, from any outcome, contains the webhook URL or its token", async () => {
    for (const status of [204, 302, 400, 401, 404, 429, 500]) {
      const { worker, logs } = make([due("1")], respond(status, { body: TOKEN }));
      await worker.tick();
      expect(JSON.stringify(logs.lines), String(status)).not.toContain(TOKEN);
      expect(JSON.stringify(logs.lines), String(status)).not.toContain("discord.com/api/webhooks");
    }
  });

  it("claims a batch and leases it (the claim asks for the batch size and the lease)", async () => {
    const { fake, worker } = make([], respond(204));
    await worker.tick();
    expect(fake.of("claim")[0]!.params).toEqual([10, 120]);
  });
});

// Added by the fresh-eyes pass (each of these behaviours survived a mutation of the worker).
describe("AlertDeliveryWorker.tick: batch behaviour", () => {
  const DEST_B = "33333333-3333-4333-8333-333333333333";
  const bodyOf = (fetchMock: ReturnType<typeof respond>, call = 0) =>
    JSON.parse((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

  it("a rate limit pauses only the destination that was limited: another destination in the same batch is still sent", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => (n++ === 0 ? new Response(null, { status: 429, headers: { "retry-after": "60" } }) : new Response(null, { status: 204 })));
    const { fake, worker } = make([due("1"), due("2"), due("3", { destination_id: DEST_B })], fetchMock as never);
    await worker.tick();
    expect(fetchMock).toHaveBeenCalledTimes(2); // row 1 (limited) and row 3; row 2 waits behind the limit
    expect(fake.outbox.get("1")).toMatchObject({ status: "pending", error: "rate_limited" });
    expect(fake.outbox.has("2")).toBe(false);
    expect(fake.outbox.get("3")).toEqual({ status: "sent" });
  });

  it("a network error or a 5xx does NOT pause the destination: the next row in the batch is still attempted", async () => {
    for (const status of [500, 0]) {
      const fetchMock = status === 0 ? vi.fn(async () => { throw new TypeError("boom"); }) : respond(status);
      const { fake, worker } = make([due("1"), due("2")], fetchMock as never);
      await worker.tick();
      expect(fetchMock, String(status)).toHaveBeenCalledTimes(2);
      expect(fake.outbox.get("2")).toMatchObject({ status: "pending" });
    }
  });

  it("a 404 stops the rest of that destination's batch, but not another destination's", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => (n++ === 0 ? new Response(null, { status: 404 }) : new Response(null, { status: 204 })));
    const { fake, worker } = make([due("1"), due("2"), due("3", { destination_id: DEST_B })], fetchMock as never);
    await worker.tick();
    expect(fake.of("disable")).toEqual([{ kind: "disable", params: [DEST, "webhook_gone"] }]);
    expect(fake.outbox.has("2")).toBe(false);
    expect(fake.outbox.get("3")).toEqual({ status: "sent" });
  });

  it("stopping mid-batch: the rows after the one in flight are not sent (they keep their lease for the next process)", async () => {
    let stop: () => Promise<void> = async () => {};
    const fetchMock = vi.fn(async () => {
      void stop();
      return new Response(null, { status: 204 });
    });
    const { fake, worker } = make([due("1"), due("2"), due("3")], fetchMock as never);
    stop = () => worker.stop();
    await worker.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.outbox.get("1")).toEqual({ status: "sent" }); // the one in flight is still recorded
    expect(fake.outbox.has("2")).toBe(false);
  });

  it("an unreadable secret is retried after the backoff for its attempt count, not immediately", async () => {
    const wrongKey = sealed(URL_OK, SERVER_UUID, otherRing);
    const { fake, worker } = make([due("1", { webhook_enc: wrongKey.data, attempts: 3 })], respond(204));
    await worker.tick();
    expect(fake.outbox.get("1")).toEqual({ status: "pending", error: "secret_unreadable", at: NOW + BASE_DELAY_MS * 4 });
  });

  it("the message carries this row's transition, severity, server name and time (and the name is escaped)", async () => {
    const { worker, fetchMock } = make(
      [due("1", { kind: "stopped_machines", subject: "group", transition: "renotify", severity: "warning", server_name: "@everyone <@1>", at_ms: NOW - 5000, summary: { machines: 3 } })],
      respond(204),
    );
    await worker.tick();
    const embed = bodyOf(fetchMock).embeds[0];
    expect(embed.title).toBe("Still stopped: 3 machines");
    expect(embed.color).toBe(0xf1c40f);
    expect(embed.timestamp).toBe(new Date(NOW - 5000).toISOString());
    expect(embed.description).toBe("**@\u200beveryone \\<@\u200b1\\>**");
    expect(embed.footer.text).toBe("stopped machines · warning");
  });

  it("a row that cannot be worded (an unknown kind or transition, e.g. from a newer build) is given up on alone: it never throws out of the batch", async () => {
    const rows = [due("1"), due("2", { kind: "mystery_kind" }), due("3", { kind: "stopped_machines", transition: "mystery_transition" }), due("4")];
    const { fake, worker, fetchMock } = make(rows, respond(204));
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fake.outbox.get("1")).toEqual({ status: "sent" });
    expect(fake.outbox.get("2")).toEqual({ status: "dead", error: "unformattable" });
    expect(fake.outbox.get("3")).toEqual({ status: "dead", error: "unformattable" });
    expect(fake.outbox.get("4")).toEqual({ status: "sent" });
  });

  it("one row whose own webhook is unreadable does not stop the good rows around it", async () => {
    const wrongKey = sealed(URL_OK, SERVER_UUID, otherRing);
    const { fake, worker, fetchMock } = make([due("1"), due("2", { webhook_enc: wrongKey.data }), due("3")], respond(204));
    await worker.tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fake.outbox.get("1")).toEqual({ status: "sent" });
    expect(fake.outbox.get("3")).toEqual({ status: "sent" });
    expect(fake.outbox.get("2")).toMatchObject({ error: "secret_unreadable" });
  });
});

describe("AlertDeliveryWorker loop", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("ticks every 10 s, survives a failing database (one warning, one recovery), and stops for good", async () => {
    const fake = fakeDb([]);
    const logs = captureLogs();
    const worker = new AlertDeliveryWorker(fake.db, ring, { logger: logs.logger, tickMs: 10_000 });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.of("claim")).toHaveLength(1);
    fake.failClaim.on = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(JSON.stringify(logs.lines).match(/ALERT_DELIVERY_TICK_FAILED/g)).toHaveLength(1);
    fake.failClaim.on = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(JSON.stringify(logs.lines)).toContain("alert delivery recovered");
    await worker.stop();
    const claims = fake.of("claim").length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.of("claim")).toHaveLength(claims);
    worker.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.of("claim")).toHaveLength(claims);
  });

  it("defaults to a 10 second tick, and starting twice does not run two loops", async () => {
    const fake = fakeDb([]);
    const worker = new AlertDeliveryWorker(fake.db, ring, { logger: captureLogs().logger });
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.of("claim")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fake.of("claim")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.of("claim")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.of("claim")).toHaveLength(4); // one loop: a tick every 10 s
    await worker.stop();
  });

  it("logs the recovery once, not after every healthy tick", async () => {
    const fake = fakeDb([]);
    const logs = captureLogs();
    const worker = new AlertDeliveryWorker(fake.db, ring, { logger: logs.logger, tickMs: 1000 });
    worker.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(JSON.stringify(logs.lines)).not.toContain("recovered");
    fake.failClaim.on = true;
    await vi.advanceTimersByTimeAsync(2_000);
    fake.failClaim.on = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(JSON.stringify(logs.lines).match(/recovered/g)).toHaveLength(1);
    await worker.stop();
  });

  it("stop() waits for the tick that is in flight (a send is never cut off mid-write)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return new Response(null, { status: 204 });
    });
    const fake = fakeDb([due("1")]);
    const worker = new AlertDeliveryWorker(fake.db, ring, { logger: captureLogs().logger, fetch: fetchMock as never, now: () => NOW });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(fake.outbox.get("1")).toEqual({ status: "sent" });
    const claims = fake.of("claim").length;
    await vi.advanceTimersByTimeAsync(60_000); // the finished tick must not schedule another one
    expect(fake.of("claim")).toHaveLength(claims);
  });
});
