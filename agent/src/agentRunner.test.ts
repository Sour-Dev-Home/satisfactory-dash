import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@satisfactory-dash/game-adapter";
import type { MappedRailSegments } from "@satisfactory-dash/game-adapter";
import { SnapshotRequestSchema } from "@satisfactory-dash/shared";
import type { AgentFactory, AgentPower, MapWorldLayer } from "@satisfactory-dash/shared";
import { agentSnapshotRequestFull, playersAvailable, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { HARNESS_SECRET as SECRET, agentRunnerHarness } from "./agentRunner.harness.js";
import { runAgent } from "./agentRunner.js";
import type { RunAgentOptions } from "./agentRunner.js";
import { BackendError } from "./backendClient.js";
import { silentLogger } from "./logger.js";
import type { WorldClient, WorldPorts } from "./worldReader.js";

/**
 * End to end, without a network or a game: the REAL client, sampler, pusher and command runner against a fake backend (which
 * validates every snapshot with the contract's schema and reads gzip bodies exactly as the real one does) and a fake game.
 */

/** A command lives about a minute (the backend's own lifetime). */
const soon = () => new Date(Date.now() + 60_000).toISOString();

describe("the whole agent", () => {
  it("pushes schema-valid snapshots with the auto-pause setting, applies the cadence the server sets, and runs a command it is handed", async () => {
    const h = agentRunnerHarness({ commands: [[{ id: "c1", type: "set_auto_pause", params: { enabled: false }, expiresAt: soon() }]] });
    const running = h.run();
    await h.until(() => h.snapshots.length >= 3 && h.results.length >= 1);
    h.stop();
    expect(await running).toBe("stopped");

    for (const snapshot of h.snapshots) expect(SnapshotRequestSchema.safeParse(snapshot).success).toBe(true);
    expect(h.snapshots[0]).toMatchObject({ reachable: true, settings: { autoPause: true }, agentVersion: "0.1.0" });
    expect(h.snapshots[0]!.power).toBeDefined();
    expect(h.snapshots[0]!.factory).toBeDefined();
    // The server's Bearer went on every request but the first-contact enrol (not used here), and only ever to its own origin.
    for (const request of h.requests) {
      expect(request.url.startsWith("https://api.example.test/agent/v1/")).toBe(true);
      expect(request.authorization).toBe(`Bearer ${SECRET}`);
      expect(request.redirect).toBe("manual");
    }
    expect(h.game.applyAutoPause).toHaveBeenCalledWith(false);
    expect(h.results).toEqual([{ id: "c1", body: { ok: true } }]);
  });

  it("an unreachable game sends `reachable: false` snapshots with no parts and no settings, then recovers", async () => {
    const h = agentRunnerHarness();
    let down = true;
    h.game.readStatus.mockImplementation(async () => {
      if (down) throw new UpstreamError("connect ECONNREFUSED 127.0.0.1:7777", { failureKind: "unreachable" });
      return { ...statusRunning.data };
    });
    const running = h.run();
    await h.until(() => h.snapshots.length >= 2);
    down = false;
    const before = h.snapshots.length;
    await h.until(() => h.snapshots.length >= before + 2);
    h.stop();
    await running;
    const unreachable = h.snapshots.filter((snapshot) => !snapshot.reachable);
    expect(unreachable.length).toBeGreaterThan(0);
    for (const snapshot of unreachable) {
      expect(Object.keys(snapshot).sort()).toEqual(["agentVersion", "observedAt", "paused", "reachable"]);
      expect(snapshot.paused).toBeNull();
    }
    // The first reachable one after the outage is a fresh start: every part is due, including the setting.
    expect(h.snapshots.find((snapshot) => snapshot.reachable)).toMatchObject({ reachable: true, settings: { autoPause: true } });
  });

  it("survives a backend outage: retries, keeps sampling into a BOUNDED queue, then sends what is left oldest first", async () => {
    const h = agentRunnerHarness({ queueMax: 4 });
    let backendDown = true;
    h.backend.snapshotHandler = () => (backendDown ? { status: 503 } : undefined);
    const running = h.run();
    await h.until(() => h.game.readStatus.mock.calls.length >= 12); // sampled a dozen times with nothing accepted
    expect(h.snapshots).toHaveLength(0);
    backendDown = false;
    await h.until(() => h.snapshots.length >= 5);
    h.stop();
    await running;
    const stamps = h.snapshots.map((snapshot) => Date.parse(snapshot.observedAt));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b)); // in order
    expect(h.events.filter((event) => event.event === "push_recovered")).toHaveLength(1);
    expect(h.events.some((event) => event.event === "queue_full_dropping_oldest")).toBe(true);
  });

  it("a 401 stops everything: `auth_rejected`, no more requests, and no retry", async () => {
    const h = agentRunnerHarness();
    h.backend.snapshotHandler = () => ({ status: 401, body: { error: { code: "unauthorized", message: "no", requestId: "r" } } });
    h.backend.commandsHandler = () => ({ status: 401, body: { error: { code: "unauthorized", message: "no", requestId: "r" } } });
    expect(await h.run()).toBe("auth_rejected");
    const count = h.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.requests.length).toBe(count);
    expect(h.events.filter((event) => event.event === "auth_rejected").length).toBeGreaterThanOrEqual(1);
  });

  it("the cadence the server sets changes how often the game is sampled", async () => {
    const h = agentRunnerHarness({ cadence: { statusSeconds: 2, powerSeconds: 2, factorySeconds: 2 } });
    const running = h.run();
    await h.until(() => h.snapshots.length >= 2);
    h.stop();
    await running;
    expect(h.sleeps.some((ms) => ms > 1_500 && ms <= 2_000)).toBe(true); // the sample loop waits about the server's 2 s
  });

  it("a command handed twice runs once (de-duplicated by id)", async () => {
    const command = { id: "dup", type: "set_auto_pause", params: { enabled: true }, expiresAt: soon() };
    const h = agentRunnerHarness({ commands: [[command], [command]] });
    const running = h.run();
    await h.until(() => h.results.length >= 2);
    h.stop();
    await running;
    expect(h.game.applyAutoPause).toHaveBeenCalledTimes(1);
  });

  it("nothing secret or personal reaches the log: no credential, no game token, no player name, no snapshot body", async () => {
    const h = agentRunnerHarness({ commands: [[{ id: "c1", type: "set_auto_pause", params: { enabled: true }, expiresAt: soon() }]] });
    h.game.readPlayers.mockImplementation(async () => ({ available: true, players: [{ name: "Alice the Builder", online: true }] }));
    h.game.applyAutoPause.mockImplementation(async () => Promise.reject(new UpstreamError(`rejected token ${SECRET} for Alice the Builder`, { status: 401 })));
    h.backend.snapshotHandler = (() => {
      let first = true;
      return () => {
        if (first) {
          first = false;
          return { status: 503 };
        }
        return undefined;
      };
    })();
    const running = h.run();
    await h.until(() => h.results.length >= 1 && h.snapshots.length >= 2);
    h.stop();
    await running;
    const log = JSON.stringify(h.events);
    for (const leaked of [SECRET, "Alice", "Builder", "ECONNREFUSED", "players", "tickRate", "sessionName"]) expect(log, leaked).not.toContain(leaked);
    expect(h.results[0]!.body).toEqual({ ok: false, code: "upstream_auth_rejected" });
    // The snapshot the backend received did carry the player list: it is data for the dashboard, just never logged.
    expect(h.snapshots.some((snapshot) => snapshot.players?.players.length === 1)).toBe(true);
  });
});

describe("the world reader inside the agent (ADR-0038 M4)", () => {
  /** A fake game, a fake backend client and a fast clock: just enough for runAgent's loops, without the harness's network. */
  function worldRun(options: { world?: boolean; postWorldLayer?: WorldClient["postWorldLayer"] } = {}) {
    const reader = {
      readStatus: vi.fn(async () => ({ ...statusRunning.data })),
      readPower: vi.fn(async () => agentSnapshotRequestFull.power as AgentPower),
      readFactory: vi.fn(async () => agentSnapshotRequestFull.factory as AgentFactory),
      readPlayers: vi.fn(async () => playersAvailable),
      readAutoPause: vi.fn(async () => true),
      applyAutoPause: vi.fn(async (_enabled: boolean) => undefined),
    };
    const world = {
      getRails: vi.fn<WorldPorts["getRails"]>(async () => ({ data: [], dropped: 0 }) as MappedRailSegments),
      getResourceNodes: vi.fn<WorldPorts["getResourceNodes"]>(async () => ({ data: [], dropped: 0 })),
    };
    const posted: MapWorldLayer[] = [];
    const client: RunAgentOptions["client"] & WorldClient = {
      postSnapshot: vi.fn(async () => ({ cadence: { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 }, commandsPending: false })),
      pollCommands: vi.fn(
        (_wait: number, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })),
      ),
      postResult: vi.fn(async () => undefined),
      postWorldLayer:
        options.postWorldLayer ??
        (async (layer) => {
          posted.push(layer);
          return { accepted: true, unchanged: false };
        }),
    };
    const controller = new AbortController();
    const sleep = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(done, Math.min(ms, 2)); // fast clock
        function done() {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        }
        signal.addEventListener("abort", done, { once: true });
      });
    const running = runAgent({ reader, client, logger: silentLogger, signal: controller.signal, sleep, random: () => 0, ...(options.world === false ? {} : { world }) });
    const until = async (condition: () => boolean) => {
      const deadline = Date.now() + 4_000;
      while (!condition() && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 5));
    };
    return { world, posted, client, running, until, stop: () => controller.abort() };
  }

  it("starts the reader with the agent: each layer is sent once (unchanged later reads send nothing), and stopping the agent stops it", async () => {
    const h = worldRun();
    await h.until(() => h.world.getRails.mock.calls.length >= 3 && h.world.getResourceNodes.mock.calls.length >= 3);
    expect(h.posted.filter((l) => l === "rails")).toHaveLength(1);
    expect(h.posted.filter((l) => l === "resourceNodes")).toHaveLength(1);
    h.stop();
    expect(await h.running).toBe("stopped");
    const reads = h.world.getRails.mock.calls.length;
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(h.world.getRails.mock.calls.length).toBe(reads);
  });

  it("edge: without `world` no world layer is read or sent (an agent built before M4 wiring behaves as before)", async () => {
    const h = worldRun({ world: false });
    await h.until(() => (h.client.postSnapshot as ReturnType<typeof vi.fn>).mock.calls.length >= 2);
    h.stop();
    expect(await h.running).toBe("stopped");
    expect(h.world.getRails).not.toHaveBeenCalled();
    expect(h.posted).toEqual([]);
  });

  it("a 401 on a world send stops the whole agent with auth_rejected", async () => {
    const h = worldRun({ postWorldLayer: async () => Promise.reject(new BackendError("auth_rejected", "401", { status: 401 })) });
    expect(await h.running).toBe("auth_rejected");
  });
});
