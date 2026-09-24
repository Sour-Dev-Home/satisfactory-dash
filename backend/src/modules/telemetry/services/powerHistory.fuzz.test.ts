import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PowerHistoryResponseSchema } from "@satisfactory-dash/shared";
import { createLogger } from "../../../platform/logger.js";
import type { PowerCircuit, ServerStatus } from "../../gameserver/index.js";
import { createTelemetryServices } from "../index.js";
import type { TelemetryPorts } from "../index.js";

const T0 = 1_700_000_000_000;

/** mulberry32: a tiny seeded RNG so a failing seed replays exactly. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const circuit = (id: number, production: number): PowerCircuit => ({
  circuitGroupId: id,
  powerProduction: production,
  powerConsumed: production / 2,
  powerCapacity: 500,
  maxPowerConsumed: 600,
  fuseTriggered: production % 3 === 0,
  batteryPercent: production % 101,
  batteryDifferential: 0,
  batteryCapacity: 0,
});

describe("power history: fuzzed producer invariants (ADR-0022)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: series ascending and capped, ranges ordered, response satisfies the schema`, async () => {
      const rand = rng(seed);
      const pick = (n: number) => Math.floor(rand() * n);
      const world = { session: "A", gameSeconds: 1000, paused: false, down: false, circuits: [circuit(0, 10)] };
      const ports = {
        async getServerStatus(): Promise<ServerStatus> {
          if (world.down) throw new Error("down");
          return {
            sessionName: world.session,
            isGameRunning: true,
            isPaused: world.paused,
            connectedPlayers: 0,
            playerLimit: 4,
            tickRate: 30,
            totalGameDurationSeconds: world.gameSeconds,
          };
        },
        async getPowerCircuits() {
          if (world.down) throw new Error("down");
          return world.circuits;
        },
      } as unknown as TelemetryPorts;
      const bundle = createTelemetryServices(ports, undefined, { logger: createLogger({ level: "silent" }) });
      const [worker] = bundle.workers;
      worker.start();

      for (let step = 0; step < 400; step++) {
        switch (pick(9)) {
          case 0:
            world.down = !world.down;
            break;
          case 1:
            world.paused = !world.paused;
            break;
          case 2:
            world.session = `S${pick(3)}`;
            break;
          case 3:
            world.gameSeconds = pick(2000); // may rewind
            break;
          case 4:
            world.circuits = Array.from({ length: pick(4) }, () => circuit(pick(5), pick(1000)));
            break;
          case 5:
            vi.setSystemTime(Date.now() - [1, 1000, 6000, 3_600_000][pick(4)]); // clock steps back
            break;
          case 6:
            vi.setSystemTime(Date.now() + [1, 1000, 6000, 3_600_000][pick(4)]); // clock steps forward
            break;
          default:
            break;
        }
        await vi.advanceTimersByTimeAsync([1, 4999, 5000, 5000, 5000, 7000, 20_000, 400_000][pick(8)]);

        const res = bundle.powerHistory.getPowerHistory();
        const { data } = res;
        const now = Date.now();
        const ctx = `seed ${seed} step ${step}`;
        const parsed = PowerHistoryResponseSchema.safeParse({ serverId: "default", ...res });
        expect(parsed.success, ctx).toBe(true);
        const cap = data.windowSeconds / data.intervalSeconds;
        for (const s of data.series) {
          expect(s.points.length, ctx).toBeLessThanOrEqual(cap);
          for (let i = 1; i < s.points.length; i++) {
            expect(s.points[i].t, ctx).toBeGreaterThan(s.points[i - 1].t);
          }
          for (const p of s.points) {
            expect(p.t, ctx).toBeGreaterThan(now - data.windowSeconds * 1000);
          }
        }
        let prevTo = -1;
        for (const r of data.pausedRanges) {
          expect(r.fromT, ctx).toBeLessThanOrEqual(r.toT);
          expect(r.fromT, ctx).toBeGreaterThan(prevTo);
          prevTo = r.toT;
        }
      }
      await worker.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  }
});
