import { describe, expect, it, vi } from "vitest";
import type { SnapshotRequest, SnapshotResponse } from "@satisfactory-dash/shared";
import { BackendError } from "./backendClient.js";
import type { AgentLogger, LogFields } from "./logger.js";
import { Pusher } from "./pusher.js";
import type { Sleep } from "./pusher.js";
import { BoundedQueue } from "./queue.js";

const answer = (over: Partial<SnapshotResponse> = {}): SnapshotResponse => ({ cadence: { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 }, commandsPending: false, ...over });
const snap = (n: number): SnapshotRequest => ({ agentVersion: "0.1.0", observedAt: `2026-09-26T12:00:${String(n).padStart(2, "0")}.000Z`, reachable: false, paused: null });
const order = (snapshots: SnapshotRequest[]) => snapshots.map((snapshot) => Number(snapshot.observedAt.slice(17, 19)));
const transient = (status?: number, retryAfterMs?: number) => new BackendError("transient", "The backend could not be reached.", { status, retryAfterMs });

function setup(post: (snapshot: SnapshotRequest) => Promise<SnapshotResponse>, max = 100) {
  const events: { level: string; event: string; fields?: LogFields }[] = [];
  const logger: AgentLogger = {
    info: (event, fields) => events.push({ level: "info", event, fields }),
    warn: (event, fields) => events.push({ level: "warn", event, fields }),
    error: (event, fields) => events.push({ level: "error", event, fields }),
    addSecret: () => undefined,
  };
  const delays: number[] = [];
  // Records the delay and yields a real (1 ms) macrotask: a sleep that only yields microtasks would starve the event loop
  // while the backend is "down", and the test's own timers would never run.
  const sleep: Sleep = async (ms) => {
    delays.push(ms);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  };
  const queue = new BoundedQueue<SnapshotRequest>(max);
  const cadences: unknown[] = [];
  const hooks = { onCommandsPending: vi.fn(), onAuthRejected: vi.fn() };
  const pusher = new Pusher({ client: { postSnapshot: post }, queue, logger, onCadence: (cadence) => cadences.push(cadence), sleep, random: () => 0, ...hooks });
  const controller = new AbortController();
  return { pusher, queue, events, delays, cadences, hooks, controller, run: () => pusher.run(controller.signal) };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
/** Polls until `condition` holds (timers on Windows are coarse, so a fixed wait would be flaky). */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise<void>((resolve) => setTimeout(resolve, 5));
}

describe("sending", () => {
  it("sends the queued snapshots oldest first, wakes when one arrives, and applies the cadence from every answer", async () => {
    const sent: SnapshotRequest[] = [];
    const t = setup(async (snapshot) => {
      sent.push(snapshot);
      return answer({ cadence: { statusSeconds: 10, powerSeconds: 10, factorySeconds: 60 } });
    });
    const running = t.run();
    await settle(); // idle: nothing to send
    expect(sent).toEqual([]);
    t.pusher.enqueue(snap(1));
    t.pusher.enqueue(snap(2));
    t.pusher.enqueue(snap(3));
    await settle();
    expect(order(sent)).toEqual([1, 2, 3]);
    expect(t.queue.size).toBe(0);
    expect(t.cadences).toEqual([{ statusSeconds: 10, powerSeconds: 10, factorySeconds: 60 }, { statusSeconds: 10, powerSeconds: 10, factorySeconds: 60 }, { statusSeconds: 10, powerSeconds: 10, factorySeconds: 60 }]);
    t.controller.abort();
    await running;
  });

  it("tells the command loop when an answer says a command is waiting", async () => {
    const t = setup(async (snapshot) => answer({ commandsPending: order([snapshot])[0] === 2 }));
    const running = t.run();
    t.pusher.enqueue(snap(1));
    t.pusher.enqueue(snap(2));
    await settle();
    expect(t.hooks.onCommandsPending).toHaveBeenCalledTimes(1);
    t.controller.abort();
    await running;
  });
});

describe("a transient failure (network, timeout, 5xx, 429)", () => {
  it("keeps the SAME snapshot at the head and retries with exponential backoff and jitter, logging the streak once and the recovery with counts", async () => {
    let failures = 3;
    const attempts: SnapshotRequest[] = [];
    const t = setup(async (snapshot) => {
      attempts.push(snapshot);
      if (failures-- > 0) throw transient(503);
      return answer();
    });
    const running = t.run();
    t.pusher.enqueue(snap(1));
    await until(() => attempts.length >= 4 && t.queue.size === 0);
    expect(attempts).toHaveLength(4);
    expect(new Set(attempts).size).toBe(1); // the same object each time
    expect(t.delays).toEqual([500, 1000, 2000]); // random() = 0 gives the floor of equal jitter: half of 1 s, 2 s, 4 s
    expect(t.events.filter((event) => event.event === "push_failed")).toEqual([{ level: "warn", event: "push_failed", fields: { code: "unreachable_or_5xx", status: 503, queued: 1 } }]);
    expect(t.events.filter((event) => event.event === "push_recovered")).toEqual([{ level: "info", event: "push_recovered", fields: { attempts: 3, queued: 0, dropped: 0 } }]);
    t.controller.abort();
    await running;
  });

  it("waits at least as long as the server's Retry-After", async () => {
    let failed = false;
    const t = setup(async () => {
      if (!failed) {
        failed = true;
        throw transient(429, 30_000);
      }
      return answer();
    });
    const running = t.run();
    t.pusher.enqueue(snap(1));
    await settle();
    expect(t.delays).toEqual([30_000]);
    t.controller.abort();
    await running;
  });

  it("an error that is not from the client (a bug) is treated as transient: the loop keeps running", async () => {
    let boom = true;
    const t = setup(async () => {
      if (boom) {
        boom = false;
        throw new TypeError("kaboom with a secret-looking token abc123");
      }
      return answer();
    });
    const running = t.run();
    t.pusher.enqueue(snap(1));
    await settle();
    expect(t.queue.size).toBe(0);
    expect(t.events[0]).toMatchObject({ event: "push_failed", fields: { code: "internal_error" } });
    expect(JSON.stringify(t.events)).not.toContain("abc123");
    t.controller.abort();
    await running;
  });
});

describe("the bounded queue during an outage", () => {
  it("drops the OLDEST when full (logged once per streak), then sends the newest ones in order once the backend is back", async () => {
    let down = true;
    const sent: SnapshotRequest[] = [];
    const t = setup(async (snapshot) => {
      if (down) throw transient(503);
      sent.push(snapshot);
      return answer();
    }, 3);
    const running = t.run();
    for (let n = 1; n <= 10; n++) {
      t.pusher.enqueue(snap(n));
      await settle();
    }
    expect(t.queue.size).toBe(3);
    expect(t.events.filter((event) => event.event === "queue_full_dropping_oldest")).toHaveLength(1);
    down = false;
    await until(() => sent.length >= 3);
    expect(order(sent)).toEqual([8, 9, 10]);
    expect(t.events.find((event) => event.event === "push_recovered")?.fields).toMatchObject({ dropped: 7 });
    t.controller.abort();
    await running;
  });

  it("a head dropped for room WHILE it is in flight is not mistaken for a newer snapshot when the answer arrives", async () => {
    let release: (() => void) | undefined;
    const sent: number[] = [];
    const t = setup(async (snapshot) => {
      sent.push(order([snapshot])[0]!);
      if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve));
      return answer();
    }, 2);
    const running = t.run();
    t.pusher.enqueue(snap(1));
    await settle(); // snap 1 is in flight
    t.pusher.enqueue(snap(2));
    t.pusher.enqueue(snap(3)); // drops snap 1, the in-flight head
    expect(t.queue.size).toBe(2);
    release?.();
    await settle();
    expect(sent).toEqual([1, 2, 3]); // 2 and 3 were NOT shifted away by 1's answer
    t.controller.abort();
    await running;
  });
});

describe("a rejected credential (401)", () => {
  it("STOPS the loop, calls onAuthRejected once, and never posts again", async () => {
    const post = vi.fn(async () => {
      throw new BackendError("auth_rejected", "The backend rejected the agent's credential (401).", { status: 401 });
    });
    const t = setup(post);
    const running = t.run();
    t.pusher.enqueue(snap(1));
    await running; // returns by itself
    t.pusher.enqueue(snap(2));
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(t.hooks.onAuthRejected).toHaveBeenCalledTimes(1);
    expect(t.delays).toEqual([]); // no backoff: it stopped
    expect(t.events).toEqual([{ level: "error", event: "auth_rejected", fields: { status: 401 } }]);
  });
});

describe("a snapshot the backend refuses (other 4xx)", () => {
  it("is dropped, the next one goes, and the refusal is logged with its code (first, then every 100th)", async () => {
    const sent: number[] = [];
    const t = setup(async (snapshot) => {
      const n = order([snapshot])[0]!;
      sent.push(n);
      if (n === 1) throw new BackendError("fatal", "refused", { status: 400, code: "invalid_request" });
      return answer();
    });
    const running = t.run();
    t.pusher.enqueue(snap(1));
    t.pusher.enqueue(snap(2));
    await settle();
    expect(sent).toEqual([1, 2]);
    expect(t.queue.size).toBe(0);
    expect(t.events).toEqual([{ level: "warn", event: "snapshot_refused", fields: { status: 400, code: "invalid_request", refused: 1 } }]);
    expect(t.delays).toEqual([]);
    t.controller.abort();
    await running;
  });
});

describe("shutdown", () => {
  it("an abort ends the loop while idle, and while waiting to retry", async () => {
    const idle = setup(async () => answer());
    const idleRun = idle.run();
    await settle();
    idle.controller.abort();
    await expect(idleRun).resolves.toBeUndefined();

    const controller = new AbortController();
    const queue = new BoundedQueue<SnapshotRequest>(5);
    const pusher = new Pusher({
      client: { postSnapshot: async () => Promise.reject(transient(503)) },
      queue,
      logger: { info() {}, warn() {}, error() {}, addSecret() {} },
      onCadence() {},
      onCommandsPending() {},
      onAuthRejected() {},
      // the real abortable sleep, with a long delay: only the abort can end it in time
      random: () => 1,
    });
    pusher.enqueue(snap(1));
    const running = pusher.run(controller.signal);
    await settle();
    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });
});
