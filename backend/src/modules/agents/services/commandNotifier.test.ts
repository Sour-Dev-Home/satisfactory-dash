import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandNotifier, MAX_WAITERS_PER_SERVER } from "./commandNotifier.js";

// ADR-0031 PR 5b: wakes an agent's long-poll the moment a command is created for its server.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Whether a promise has settled, without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  return done;
}

describe("CommandNotifier", () => {
  it("wakes every waiter of a server when a command is created, and only that server's", async () => {
    const notifier = new CommandNotifier();
    const a1 = notifier.subscribe("srv-a", 25_000);
    const a2 = notifier.subscribe("srv-a", 25_000);
    const b = notifier.subscribe("srv-b", 25_000);
    notifier.notify("srv-a");
    expect(await settled(a1.wake)).toBe(true);
    expect(await settled(a2.wake)).toBe(true);
    expect(await settled(b.wake)).toBe(false);
    expect(notifier.waiting("srv-a")).toBe(0);
    expect(notifier.waiting("srv-b")).toBe(1);
    b.cancel();
  });

  it("does not lose a wake-up that arrives after subscribing but before the caller starts waiting", async () => {
    const notifier = new CommandNotifier();
    const subscription = notifier.subscribe("srv", 25_000); // the poll subscribes, THEN looks at the database...
    notifier.notify("srv"); // ...and a command is created in between
    expect(await settled(subscription.wake)).toBe(true); // the later `await wake` returns at once
  });

  it("wakes when the time is up, and leaves nothing behind", async () => {
    const notifier = new CommandNotifier();
    const subscription = notifier.subscribe("srv", 25_000);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(await settled(subscription.wake)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(subscription.wake)).toBe(true);
    expect(notifier.waiting("srv")).toBe(0);
  });

  it("wakes when the client hangs up (abort), also one that was already gone before it subscribed", async () => {
    const notifier = new CommandNotifier();
    const controller = new AbortController();
    const subscription = notifier.subscribe("srv", 25_000, controller.signal);
    controller.abort();
    expect(await settled(subscription.wake)).toBe(true);
    expect(notifier.waiting("srv")).toBe(0);
    const gone = new AbortController();
    gone.abort();
    expect(await settled(notifier.subscribe("srv", 25_000, gone.signal).wake)).toBe(true);
    expect(notifier.waiting("srv")).toBe(0);
  });

  it("cancel stops waiting, twice is harmless, and the timer is cleared (no late callback)", async () => {
    const notifier = new CommandNotifier();
    const subscription = notifier.subscribe("srv", 25_000);
    subscription.cancel();
    subscription.cancel();
    expect(notifier.waiting("srv")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it(`keeps at most ${MAX_WAITERS_PER_SERVER} waiters per server: a new one releases the OLDEST at once`, async () => {
    const notifier = new CommandNotifier();
    const subscriptions = Array.from({ length: MAX_WAITERS_PER_SERVER }, () => notifier.subscribe("srv", 25_000));
    expect(notifier.waiting("srv")).toBe(MAX_WAITERS_PER_SERVER);
    const newest = notifier.subscribe("srv", 25_000);
    expect(await settled(subscriptions[0]!.wake)).toBe(true); // evicted
    expect(await settled(subscriptions[1]!.wake)).toBe(false);
    expect(notifier.waiting("srv")).toBe(MAX_WAITERS_PER_SERVER);
    for (const s of [...subscriptions, newest]) s.cancel();
  });

  it("notifying a server nobody waits for is a no-op", () => {
    expect(() => new CommandNotifier().notify("nobody")).not.toThrow();
  });

  it("a waiter released once is not released again by a later notify (no double work)", async () => {
    const notifier = new CommandNotifier();
    const subscription = notifier.subscribe("srv", 25_000);
    notifier.notify("srv");
    notifier.notify("srv");
    expect(await settled(subscription.wake)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
