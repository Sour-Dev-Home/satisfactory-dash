import { describe, it, expect } from "vitest";
import request from "supertest";
import { PowerResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { ApiFailure } from "../../../platform/errorResponse.js";
import { createLogger } from "../../../platform/logger.js";
import { SatisfactoryServerAdapter } from "../../gameserver/index.js";
import { powerCircuitFixture } from "@satisfactory-dash/game-adapter/fixtures";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createTelemetryRouters, createTelemetryServices } from "../index.js";

/** ADR-0052 1.3 through the real adapter, service and route: a request-through server serves its last good power
 *  reading stale while the game is down. Only the FRM client is scripted. */
function appWithFrm(steps: Array<unknown>, now: () => number) {
  let i = 0;
  const adapter = new SatisfactoryServerAdapter(
    { call: async () => undefined as never },
    {
      get: async () => {
        const step = steps[Math.min(i++, steps.length - 1)];
        if (step instanceof Error) throw step;
        return step as never;
      },
    },
  );
  const directory = new InMemoryServerDirectory([
    { id: "default", displayName: "Test server", services: { telemetry: createTelemetryServices(adapter, undefined, { now }) } },
  ]);
  return createApp({ logger: createLogger(), routers: createTelemetryRouters(directory) });
}

describe("request-through last good (ADR-0052)", () => {
  const path = endpoints.power.path("default");
  const T0 = Date.parse("2026-10-24T10:00:00.000Z");

  it("serves the last power reading stale, valid against the shared schema, then recovers", async () => {
    let clock = T0;
    const app = appWithFrm(
      [[powerCircuitFixture], new ApiFailure("upstream_unreachable", "down"), new ApiFailure("upstream_unreachable", "down"), [powerCircuitFixture]],
      () => clock,
    );
    expect((await request(app).get(path)).body.stale).toBe(false);
    clock = T0 + 5000;
    const first = await request(app).get(path);
    expect(first.status).toBe(200);
    expect(PowerResponseSchema.parse(first.body)).toMatchObject({
      stale: true,
      observedAt: new Date(T0).toISOString(),
      unreachableSince: new Date(T0 + 5000).toISOString(),
    });
    clock = T0 + 9000;
    expect((await request(app).get(path)).body.unreachableSince).toBe(new Date(T0 + 5000).toISOString());
    const back = await request(app).get(path);
    expect(back.body.stale).toBe(false);
    expect("unreachableSince" in back.body).toBe(false);
  });

  it("answers 503 when nothing was read yet, and 502 for an auth rejection even after a success", async () => {
    const cold = appWithFrm([new ApiFailure("upstream_unreachable", "down")], () => T0);
    expect((await request(cold).get(path)).status).toBe(503);
    const rejected = appWithFrm([[powerCircuitFixture], new ApiFailure("upstream_auth_rejected", "no")], () => T0);
    await request(rejected).get(path);
    const res = await request(rejected).get(path);
    expect(res.status).not.toBe(200);
    expect(res.body.error.code).toBe("upstream_auth_rejected");
  });
});
