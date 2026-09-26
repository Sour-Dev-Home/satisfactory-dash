import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { SnapshotRequestSchema } from "@satisfactory-dash/shared";
import type { AgentFactory, AgentPower } from "@satisfactory-dash/shared";
import { agentSnapshotRequestFull, playersAvailable, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { CommandRunner, MIN_POLL_SPACING_MS } from "./commandRunner.js";
import { conformFactory, conformStatus } from "./conform.js";
import { silentLogger } from "./logger.js";
import { readHidden } from "./prompt.js";
import type { PromptInput } from "./prompt.js";
import { Pusher } from "./pusher.js";
import { BoundedQueue } from "./queue.js";
import { runAgent } from "./agentRunner.js";
import { Sampler } from "./sampler.js";
import type { GameReader } from "./sampler.js";
import { isAllowedGameHost } from "./store.js";

/** Independent review pass (fresh eyes): each test below documents a real defect found by adversarial reading. */

const T0 = Date.parse("2026-09-26T12:00:00.000Z");
const baseBuilding = agentSnapshotRequestFull.factory.buildings[0]!;
const accepted = (parts: object) => SnapshotRequestSchema.safeParse({ ...agentSnapshotRequestFull, ...parts }).success;

describe("conform vs the schema: gaps the seeded fuzz never reached", () => {
  it("a building whose rotation is outside [0, 360) is still accepted (the schema refuses a whole snapshot for it)", () => {
    for (const rotationDeg of [-10, 360, 720.5, -1e-20]) {
      const { value } = conformFactory({ buildings: [{ ...baseBuilding, location: { xM: 1, yM: 2, zM: 3, rotationDeg } }] as AgentFactory["buildings"] });
      expect(accepted({ factory: value }), `rotation ${rotationDeg}`).toBe(true);
    }
  });

  it("a status with a negative or fractional count or a negative tick rate is accepted", () => {
    const status = conformStatus({ ...agentSnapshotRequestFull.status, connectedPlayers: -1, playerLimit: 4.5, tickRate: -0.0001, totalGameDurationSeconds: -5 });
    expect(accepted({ status })).toBe(true);
  });

  it("a status with a non-finite number is not sent as a value (unknown is not zero): the read fails instead", () => {
    expect(() => conformStatus({ ...agentSnapshotRequestFull.status, tickRate: Number.NaN })).toThrow();
  });
});

describe("game host allow-list", () => {
  it("does not let a URL-injection string pass as an IPv6 private address (the token would go to another host)", () => {
    for (const host of ["fd00:@evil.example.com", "fe80:.evil.example.com", "fc00:/@evil.com", "fd00::1@evil.com", "fd00::1 evil.com", "[fd00:@evil.com]"]) {
      expect(isAllowedGameHost(host), host).toBe(false);
    }
  });
  it("still allows real private IPv6 addresses", () => {
    for (const host of ["::1", "[::1]", "fd12:3456:789a::1", "fe80::1", "fe80::1%eth0"]) expect(isAllowedGameHost(host), host).toBe(true);
  });
});

function reader(): GameReader {
  return {
    readStatus: vi.fn(async () => ({ ...statusRunning.data })),
    readPower: vi.fn(async () => agentSnapshotRequestFull.power as AgentPower),
    readFactory: vi.fn(async () => agentSnapshotRequestFull.factory as AgentFactory),
    readPlayers: vi.fn(async () => playersAvailable),
    readAutoPause: vi.fn(async () => true),
    applyAutoPause: vi.fn(async () => undefined),
  };
}

describe("sampler timing", () => {
  it("a timer that fires 1 ms early does not push a part a whole extra period back", async () => {
    const r = reader();
    const sampler = new Sampler({ reader: r, cadence: () => ({ statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 }), logger: silentLogger });
    await sampler.sample(T0);
    await sampler.sample(T0 + 4_999); // the loop's sleep woke 1 ms early
    expect(r.readPower).toHaveBeenCalledTimes(2);
    expect(r.readAutoPause).toHaveBeenCalledTimes(2);
  });

  it("a clock that jumps backwards does not silence the slow parts until it catches up", async () => {
    const r = reader();
    const sampler = new Sampler({ reader: r, cadence: () => ({ statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 }), logger: silentLogger });
    await sampler.sample(T0);
    await sampler.sample(T0 - 3_600_000); // the PC's clock was corrected an hour back
    expect(r.readPower).toHaveBeenCalledTimes(2);
    expect(r.readFactory).toHaveBeenCalledTimes(2);
  });
});

describe("clock jumps backwards do not stall the loops", () => {
  it("the command runner's poll spacing never exceeds its floor", async () => {
    const delays: number[] = [];
    const controller = new AbortController();
    let calls = 0;
    const now = () => (calls++ === 0 ? T0 : T0 - 3_600_000);
    const runner = new CommandRunner({
      client: {
        pollCommands: vi.fn(async (_w: number, signal?: AbortSignal) => {
          if (delays.length > 0) await new Promise<void>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
          return [];
        }),
        postResult: vi.fn(async () => undefined),
      },
      game: { applyAutoPause: vi.fn() },
      logger: silentLogger,
      now,
      sleep: async (ms) => {
        delays.push(ms);
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
      onAuthRejected: () => undefined,
    });
    const running = runner.run(controller.signal);
    for (let i = 0; i < 100 && delays.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await running;
    expect(delays[0]).toBeLessThanOrEqual(MIN_POLL_SPACING_MS);
  });

  it("the sample loop never sleeps longer than one period", async () => {
    const delays: number[] = [];
    const controller = new AbortController();
    let calls = 0;
    const now = () => (calls++ === 0 ? T0 : T0 - 3_600_000);
    const outcome = runAgent({
      reader: reader(),
      client: {
        postSnapshot: async () => ({ cadence: { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 }, commandsPending: false }),
        pollCommands: (_w: number, signal?: AbortSignal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")))),
        postResult: async () => undefined,
      },
      logger: silentLogger,
      signal: controller.signal,
      now,
      sleep: async (ms) => {
        delays.push(ms);
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
    });
    for (let i = 0; i < 100 && delays.length < 3; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await outcome;
    expect(Math.max(...delays)).toBeLessThanOrEqual(60_000);
  });
});

describe("pusher shutdown", () => {
  it("hands the stop signal to the request, so a stop does not wait out a 15 s timeout", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const queue = new BoundedQueue<never>(5);
    const pusher = new Pusher({
      client: { postSnapshot: (async (_s: unknown, signal?: AbortSignal) => (seen.push(signal), await new Promise(() => undefined))) as never },
      queue,
      logger: silentLogger,
      onCadence: () => undefined,
      onCommandsPending: () => undefined,
      onAuthRejected: () => undefined,
    });
    const controller = new AbortController();
    void pusher.run(controller.signal);
    pusher.enqueue({ agentVersion: "0.1.0", observedAt: new Date(T0).toISOString(), reachable: false, paused: null });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(seen[0]).toBeDefined();
  });
});

describe("prompt with piped input", () => {
  const piped = () => new PassThrough() as PassThrough & PromptInput;
  const sink = { write: () => true };
  const within = <T,>(promise: Promise<T>, ms = 500) => Promise.race([promise, new Promise<string>((resolve) => setTimeout(() => resolve("HUNG"), ms))]);

  it("two prompts fed by two piped lines each get their own line", async () => {
    const stdin = piped();
    stdin.write("api-token\nfrm-token\n");
    stdin.end();
    expect(await within(readHidden("a: ", { stdin, stderr: sink }))).toBe("api-token");
    expect(await within(readHidden("b: ", { stdin, stderr: sink }))).toBe("frm-token");
  });

  it("CRLF line endings do not leave an empty line for the next prompt", async () => {
    const stdin = piped();
    stdin.write("api-token\r\nfrm-token\r\n");
    stdin.end();
    expect(await within(readHidden("a: ", { stdin, stderr: sink }))).toBe("api-token");
    expect(await within(readHidden("b: ", { stdin, stderr: sink }))).toBe("frm-token");
  });

  it("a second prompt on an input that already ended returns empty instead of hanging forever", async () => {
    const stdin = piped();
    stdin.write("only-one\n");
    stdin.end();
    expect(await within(readHidden("a: ", { stdin, stderr: sink }))).toBe("only-one");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await within(readHidden("b: ", { stdin, stderr: sink }))).toBe("");
  });
});
