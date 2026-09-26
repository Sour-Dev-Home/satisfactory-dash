import { describe, expect, it } from "vitest";
import request from "supertest";
import {
  FactoryResponseSchema,
  PowerHistoryResponseSchema,
  PowerResponseSchema,
  ServerPlayersResponseSchema,
  StatusResponseSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import { agentSnapshotRequestFull, agentSnapshotRequestPartial, agentSnapshotRequestUnreachable, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { InMemoryServerDirectory } from "../servers/index.js";
import { createAgentTelemetryServices, createTelemetryRouters } from "./index.js";

const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const T0 = Date.parse("2026-09-26T12:00:00.000Z");

/** The real telemetry routes over an agent-backed server, on a fake clock: what a member's browser would get. */
function setup() {
  let nowMs = T0;
  const telemetry = createAgentTelemetryServices({
    cadence: () => CADENCE,
    now: () => nowMs,
    history: { db: { query: async () => ({ rows: [] }) } as never, serverPublicId: "alpha" },
  });
  const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services: { telemetry } }]);
  const app = createApp({ logger: createLogger({ level: "silent" }, { write: () => {} }), routers: createTelemetryRouters(directory) });
  return {
    app,
    telemetry,
    advance: (ms: number) => {
      nowMs += ms;
    },
    send: (body: Record<string, unknown>, receivedAt = nowMs) =>
      telemetry.agentIngest!.ingest({ ...agentSnapshotRequestFull, ...body, observedAt: new Date(receivedAt).toISOString() } as never, receivedAt),
  };
}

const get = (t: ReturnType<typeof setup>, route: string) => request(t.app).get(route.replace(":serverId", "alpha"));

describe("an agent-backed server's live routes", () => {
  it("say the data is unavailable before the agent has reported (503 upstream_unreachable)", async () => {
    const t = setup();
    for (const route of [endpoints.status.route, endpoints.factory.route, endpoints.power.route]) {
      const res = await get(t, route);
      expect(res.status, route).toBe(503);
      expect(res.body.error.code).toBe("upstream_unreachable");
    }
  });

  it("serve the agent's last snapshot with ITS time, fresh, in the contract's envelopes", async () => {
    const t = setup();
    t.send({});
    const status = StatusResponseSchema.parse((await get(t, endpoints.status.route)).body);
    expect(status).toMatchObject({ serverId: "alpha", observedAt: new Date(T0).toISOString(), stale: false, data: { sessionName: statusRunning.data.sessionName } });
    expect(FactoryResponseSchema.parse((await get(t, endpoints.factory.route)).body).observedAt).toBe(new Date(T0).toISOString());
    expect(PowerResponseSchema.parse((await get(t, endpoints.power.route)).body).stale).toBe(false);
    expect(ServerPlayersResponseSchema.parse((await get(t, endpoints.players.route)).body).available).toBe(true);
  });

  it("do not call the game or the clock: the observedAt stays the snapshot's however much later it is read", async () => {
    const t = setup();
    t.send({});
    t.advance(16_000);
    const status = StatusResponseSchema.parse((await get(t, endpoints.status.route)).body);
    expect(status.observedAt).toBe(new Date(T0).toISOString());
    expect(status.stale).toBe(true); // 16 s > 3 x 5 s
  });

  it("are stale per part: the factory (30 s cadence) outlives status and power (5 s)", async () => {
    const t = setup();
    t.send({});
    t.advance(20_000); // status and power are stale after 15 s, the factory after 90 s
    expect(StatusResponseSchema.parse((await get(t, endpoints.status.route)).body).stale).toBe(true);
    expect(FactoryResponseSchema.parse((await get(t, endpoints.factory.route)).body).stale).toBe(false);
  });

  it("keep serving a part a later snapshot did not carry, with the earlier time", async () => {
    const t = setup();
    t.send({});
    t.advance(5000);
    t.telemetry.agentIngest!.ingest({ ...agentSnapshotRequestPartial, observedAt: new Date(T0 + 5000).toISOString() }, T0 + 5000);
    const factory = FactoryResponseSchema.parse((await get(t, endpoints.factory.route)).body);
    expect(factory.observedAt).toBe(new Date(T0).toISOString());
    expect(StatusResponseSchema.parse((await get(t, endpoints.status.route)).body).observedAt).toBe(new Date(T0 + 5000).toISOString());
  });

  it("say the game is unreachable when the agent says so, and recover with the next reachable snapshot", async () => {
    const t = setup();
    t.send({});
    t.advance(5000);
    t.telemetry.agentIngest!.ingest({ ...agentSnapshotRequestUnreachable, observedAt: new Date(T0 + 5000).toISOString() }, T0 + 5000);
    const down = await get(t, endpoints.status.route);
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe("upstream_unreachable");
    t.advance(5000);
    t.send({});
    expect((await get(t, endpoints.status.route)).status).toBe(200);
  });

  it("answer 'no player list' (not an error) when the agent has no player data", async () => {
    const t = setup();
    t.send({ players: undefined });
    const players = ServerPlayersResponseSchema.parse((await get(t, endpoints.players.route)).body);
    expect(players).toEqual({ available: false, players: [] });
  });

  it("serve the power chart from the ingested power readings", async () => {
    const t = setup();
    t.send({});
    t.advance(1000);
    const res = await get(t, endpoints.powerHistory.route);
    expect(res.status).toBe(200);
    const history = PowerHistoryResponseSchema.parse(res.body);
    expect(history.stale).toBe(false);
    expect(history.data.series.length).toBeGreaterThan(0);
  });

  it("feed the alert engine's board like a polled server: a reachable snapshot is a success, an unreachable one a failure", () => {
    const t = setup();
    t.send({});
    expect(t.telemetry.observations!.snapshot().polls).toMatchObject({ consecutiveFailures: 0, lastSuccessAt: T0 });
    t.telemetry.agentIngest!.ingest({ ...agentSnapshotRequestUnreachable, observedAt: new Date(T0 + 1000).toISOString() }, T0 + 1000);
    expect(t.telemetry.observations!.snapshot().polls.consecutiveFailures).toBe(1);
  });

  it("has only the history recorder as a worker (no poller, nothing calls a game server)", () => {
    expect(setup().telemetry.workers).toHaveLength(1);
  });
});
