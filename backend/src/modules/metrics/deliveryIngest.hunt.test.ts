import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { endpoints } from "@satisfactory-dash/shared";
import type { DeliverySnapshot } from "@satisfactory-dash/shared";
import { deliverySnapshotSample } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { createDeliveryIngestRouter, bearerMatches } from "./deliveryIngest.js";

const SECRET = "hunt-secret-0123456789abcdefABCDEF-xyz";
const DIGEST = Buffer.from(createHash("sha256").update(SECRET).digest("hex"), "hex");
const PATH = endpoints.metrics.deliveryIngest.path();

const guard: RequestHandler = (_req, res) => {
  res.status(401).json({ error: { code: "unauthorized", message: "Sign in", requestId: "t" } });
};

function build() {
  const store = vi.fn(async (_s: DeliverySnapshot) => {});
  const app = createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [createDeliveryIngestRouter({ config: { secretSha256: DIGEST }, store })],
    sessionGuard: guard,
    protectedRouters: [],
  });
  return { app, store };
}

const auth = { Authorization: `Bearer ${SECRET}` };

describe("delivery ingest, hostile inputs", () => {
  it("answers the path case-insensitively and with a trailing slash the same way (never the session guard)", async () => {
    const { app, store } = build();
    for (const p of [PATH + "/", PATH.toUpperCase()]) {
      const res = await request(app).post(p).set(auth).set("Content-Type", "application/json").send(JSON.stringify(deliverySnapshotSample));
      expect(res.status, p).toBe(200);
    }
    expect(store).toHaveBeenCalledTimes(2);
  });

  it("400 for a JSON array, a string and null body (never stored)", async () => {
    const { app, store } = build();
    for (const body of ["[]", '"x"', "null", "123"]) {
      const res = await request(app).post(PATH).set(auth).set("Content-Type", "application/json").send(body);
      expect([400]).toContain(res.status);
    }
    expect(store).not.toHaveBeenCalled();
  });

  it("400 for malformed JSON and for an empty body", async () => {
    const { app, store } = build();
    expect((await request(app).post(PATH).set(auth).set("Content-Type", "application/json").send("{")).status).toBe(400);
    expect((await request(app).post(PATH).set(auth).set("Content-Type", "application/json").send("")).status).toBe(400);
    expect(store).not.toHaveBeenCalled();
  });

  it("400 for an unknown extra field, a wrong schemaVersion and a negative count", async () => {
    const { app, store } = build();
    const bad = [
      { ...deliverySnapshotSample, login: "someone" },
      { ...deliverySnapshotSample, schemaVersion: 1 },
      { ...deliverySnapshotSample, throughput: { ...deliverySnapshotSample.throughput, mergedPrs: -1 } },
    ];
    for (const body of bad) {
      const res = await request(app).post(PATH).set(auth).set("Content-Type", "application/json").send(JSON.stringify(body));
      expect(res.status).toBe(400);
    }
    expect(store).not.toHaveBeenCalled();
  });

  it("a wrong secret with a malformed body is 401 (the body is never parsed)", async () => {
    const { app } = build();
    const res = await request(app).post(PATH).set("Authorization", "Bearer wrong-wrong-wrong-wrong-wrong-wrong-").set("Content-Type", "application/json").send("{");
    expect(res.status).toBe(401);
  });

  it("GET and PUT on the path never store", async () => {
    const { app, store } = build();
    await request(app).get(PATH).set(auth);
    await request(app).put(PATH).set(auth).set("Content-Type", "application/json").send(JSON.stringify(deliverySnapshotSample));
    expect(store).not.toHaveBeenCalled();
  });

  it("bearerMatches refuses repeated/odd headers and non-string values", () => {
    expect(bearerMatches(undefined, DIGEST)).toBe(false);
    expect(bearerMatches([`Bearer ${SECRET}`], DIGEST)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET} `, DIGEST)).toBe(false);
    expect(bearerMatches(`Bearer  ${SECRET}`, DIGEST)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET}\n`, DIGEST)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET}`, Buffer.alloc(0))).toBe(false);
  });
});
