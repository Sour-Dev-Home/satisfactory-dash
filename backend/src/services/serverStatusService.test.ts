import { describe, it, expect } from "vitest";
import { ServerStatusService } from "./serverStatusService.js";
import type { ServerStatusAdapterLike } from "./serverStatusService.js";
import type { ServerStatus } from "../adapters/domain.js";

describe("ServerStatusService", () => {
  it("merges health and status into a single response", async () => {
    const adapter: ServerStatusAdapterLike = {
      getServerHealth: async () => ({ healthy: true }),
      getServerStatus: async () => ({
        sessionName: "my-save",
        isGameRunning: true,
        isPaused: false,
        connectedPlayers: 2,
        playerLimit: 4,
        tickRate: 30,
        totalGameDurationSeconds: 100,
      }),
    };
    const service = new ServerStatusService(adapter);
    await expect(service.getStatus()).resolves.toEqual({
      healthy: true,
      sessionName: "my-save",
      isGameRunning: true,
      isPaused: false,
      connectedPlayers: 2,
      playerLimit: 4,
      tickRate: 30,
      totalGameDurationSeconds: 100,
    });
  });

  // Per docs-vault/raw-sources/dedicated-server-api.md line ~310, the vanilla API's
  // HealthCheck reports "healthy" if tick rate > 10 tps, "slow" otherwise — it does
  // NOT throw for a slow-but-reachable server. satisfactoryServerAdapter.ts maps that
  // to `healthy: false` without raising. So `healthy: false` is a legitimate resolved
  // value, distinct from the adapter call rejecting (unreachable server). The service
  // must pass that through rather than treating it as an error.
  it("passes through healthy: false for a reachable-but-slow server without throwing", async () => {
    const adapter: ServerStatusAdapterLike = {
      getServerHealth: async () => ({ healthy: false }),
      getServerStatus: async () => ({
        sessionName: "my-save",
        isGameRunning: true,
        isPaused: false,
        connectedPlayers: 2,
        playerLimit: 4,
        tickRate: 4,
        totalGameDurationSeconds: 100,
      }),
    };
    const service = new ServerStatusService(adapter);
    await expect(service.getStatus()).resolves.toMatchObject({ healthy: false, tickRate: 4 });
  });

  it("propagates a rejection from getServerHealth rather than swallowing it", async () => {
    const adapter: ServerStatusAdapterLike = {
      getServerHealth: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      getServerStatus: async () => ({
        sessionName: "my-save",
        isGameRunning: true,
        isPaused: false,
        connectedPlayers: 0,
        playerLimit: 4,
        tickRate: 30,
        totalGameDurationSeconds: 100,
      }),
    };
    const service = new ServerStatusService(adapter);
    await expect(service.getStatus()).rejects.toThrow("connect ECONNREFUSED");
  });

  it("propagates a rejection from getServerStatus rather than swallowing it", async () => {
    const adapter: ServerStatusAdapterLike = {
      getServerHealth: async () => ({ healthy: true }),
      getServerStatus: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };
    const service = new ServerStatusService(adapter);
    await expect(service.getStatus()).rejects.toThrow("connect ECONNREFUSED");
  });

  // Found by an independent CI review pass: getStatus used to build its return value
  // with `{ healthy, ...status }`, which bypasses TypeScript's excess-property
  // checking. This test simulates a future ServerStatus field the response type
  // hasn't been updated for yet, and asserts it does NOT leak through -- with a
  // spread it silently would have, with no compile error either.
  it("does not leak an adapter-only field that isn't part of ServerStatusResponse", async () => {
    const adapter: ServerStatusAdapterLike = {
      getServerHealth: async () => ({ healthy: true }),
      getServerStatus: async () =>
        ({
          sessionName: "my-save",
          isGameRunning: true,
          isPaused: false,
          connectedPlayers: 2,
          playerLimit: 4,
          tickRate: 30,
          totalGameDurationSeconds: 100,
          internalDebugFlag: true,
        }) as ServerStatus & { internalDebugFlag: boolean },
    };
    const service = new ServerStatusService(adapter);
    const status = await service.getStatus();
    expect(status).not.toHaveProperty("internalDebugFlag");
    expect(Object.keys(status).sort()).toEqual(
      [
        "healthy",
        "sessionName",
        "isGameRunning",
        "isPaused",
        "connectedPlayers",
        "playerLimit",
        "tickRate",
        "totalGameDurationSeconds",
      ].sort(),
    );
  });
});
