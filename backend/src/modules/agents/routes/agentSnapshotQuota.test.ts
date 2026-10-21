import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { agentSnapshotRequestFull } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createAgentTelemetryServices, createTelemetryRouters } from "../../telemetry/index.js";
import { MAX_POWER_SAMPLE_CIRCUITS, MAX_UNCATALOGED_ITEMS_PER_SAMPLE } from "../../telemetry/services/historyQuota.js";
import { sha256 } from "../repositories/agentRepository.js";
import { createAgentAuth } from "../services/agentAuth.js";
import { createAgentApiRouter } from "./agentApi.js";

/**
 * #515 (ADR-0045 M11), end to end: a forged snapshot posted through the Express app, into the real agent ingest and
 * history recorder, writes only the capped rows, while the live routes still serve the whole reading.
 */
const SECRET = "S".repeat(43);
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const NOW = Date.parse("2026-10-20T12:00:00.000Z");

function setup() {
  const inserted = new Map<string, number>();
  // The credential lookup answers for alpha; each history insert counts the rows of its first unnested column.
  const db: Queryable = {
    async query(text, values = []) {
      if (text.includes("secret_hash = $1")) {
        return { rows: (values[0] as Buffer).equals(sha256(SECRET)) ? [{ server_id: "11111111-1111-4111-8111-111111111111", public_id: "alpha" }] : [] };
      }
      const table = /INSERT INTO telemetry\.(\w+)/.exec(text)?.[1];
      if (table !== undefined) inserted.set(table, (inserted.get(table) ?? 0) + ((values.find(Array.isArray) as unknown[] | undefined)?.length ?? 0));
      return { rows: [] };
    },
  };
  const telemetry = createAgentTelemetryServices({ cadence: () => CADENCE, now: () => NOW, history: { db: db as never, serverPublicId: "alpha" } });
  const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services: { telemetry } }]);
  const app = createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: createTelemetryRouters(directory),
    agentRouters: [
      createAgentApiRouter({
        auth: createAgentAuth({ db, now: () => NOW }),
        enrollment: { enroll: vi.fn() },
        commands: { poll: vi.fn(async () => []), report: vi.fn(async () => undefined), hasPending: vi.fn(async () => false) },
        directory: directory as never,
        attachAgentRuntime: vi.fn(async () => undefined),
        recordVersion: async () => {},
        cadence: () => CADENCE,
        now: () => NOW,
      }),
    ],
  });
  // The recorder is the agent server's one worker: stopping it flushes what it buffered.
  const flush = () => Promise.all(telemetry.workers.map((worker) => worker.stop()));
  return { app, inserted, flush };
}

const post = (app: ReturnType<typeof setup>["app"], body: unknown) =>
  request(app).post("/agent/v1/snapshots").set("Authorization", `Bearer ${SECRET}`).set("Content-Type", "application/json").send(JSON.stringify(body));

/** 1,000 circuits (the schema's maximum) and 200 buildings each making 16 made-up items: 3,200 "items". */
function forgedSnapshot() {
  const circuit = agentSnapshotRequestFull.power.circuits[0]!;
  const building = agentSnapshotRequestFull.factory.buildings[0]!;
  const rate = building.production[0]!;
  return {
    ...agentSnapshotRequestFull,
    observedAt: new Date(NOW).toISOString(),
    power: { circuits: Array.from({ length: 1000 }, (_, i) => ({ ...circuit, circuitGroupId: i + 1 })) },
    factory: {
      ...agentSnapshotRequestFull.factory,
      buildings: Array.from({ length: 200 }, (_, b) => ({
        ...building,
        id: `forged-${b}`,
        production: Array.from({ length: 16 }, (_, r) => ({ ...rate, name: "Forged", className: `Desc_Forged${b * 16 + r}_C` })),
      })),
    },
  };
}

describe("POST /agent/v1/snapshots over the per-server history caps (#515)", () => {
  it("a forged snapshot over each cap is accepted, served live in full, and records only the capped rows", async () => {
    const t = setup();
    const res = await post(t.app, forgedSnapshot());
    expect(res.status).toBe(200);
    // The live view is not affected: all 1,000 circuits are served.
    const power = await request(t.app).get("/api/servers/alpha/power");
    expect(power.status).toBe(200);
    expect(power.body.data.circuits).toHaveLength(1000);
    await t.flush();
    expect(t.inserted.get("power_samples")).toBe(MAX_POWER_SAMPLE_CIRCUITS);
    expect(t.inserted.get("item_samples")).toBe(MAX_UNCATALOGED_ITEMS_PER_SAMPLE);
  });

  it("the honest fixture snapshot (catalog items, few circuits) records every row", async () => {
    const t = setup();
    const snapshot = { ...agentSnapshotRequestFull, observedAt: new Date(NOW).toISOString() };
    expect((await post(t.app, snapshot)).status).toBe(200);
    await t.flush();
    expect(t.inserted.get("power_samples")).toBe(agentSnapshotRequestFull.power.circuits.length);
    const items = new Set(agentSnapshotRequestFull.factory.buildings.flatMap((building) => building.production.map((rate) => rate.className)));
    expect(t.inserted.get("item_samples")).toBe(items.size);
  });
});
