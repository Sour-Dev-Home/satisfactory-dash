import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// public/push-sw.js is a plain script (no build step, no imports), so the test runs the shipped file itself in a
// sandbox that stands in for the worker's global scope, and drives its two event listeners.

// (Vitest runs from frontend/.)
const SOURCE = readFileSync(resolve("public/push-sw.js"), "utf8");

type Listener = (event: unknown) => void;
interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
}

function load(clientList: FakeClient[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(() => Promise.resolve());
  const openWindow = vi.fn(() => Promise.resolve(null));
  const matchAll = vi.fn(() => Promise.resolve(clientList));
  const self: Record<string, unknown> = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: { showNotification },
    clients: { matchAll, openWindow },
  };
  runInNewContext(SOURCE, { self, URL });
  return { self, listeners, showNotification, openWindow, matchAll };
}

const pushEvent = (data: unknown) => {
  const waits: Promise<unknown>[] = [];
  return { event: { data, waitUntil: (p: Promise<unknown>) => waits.push(p) }, done: () => Promise.all(waits) };
};
const dataOf = (value: unknown) => ({ json: () => value });
const PAYLOAD = {
  v: 1,
  title: "Power outage on Home world",
  body: "Circuit 3 lost power.",
  serverId: "home",
  kind: "power_outage",
  transition: "fired",
  severity: "critical",
  at: "2026-10-21T10:00:00.000Z",
};

describe("push-sw.js", () => {
  it("has a push and a notificationclick handler, and no fetch handler or cache", () => {
    const { listeners } = load();
    expect([...listeners.keys()].sort()).toEqual(["notificationclick", "push"]);
    expect(SOURCE).not.toMatch(/\bcaches\b/);
    expect(SOURCE).not.toMatch(/["']fetch["']/);
  });

  it("shows the payload's title and body, one notification per server and kind", async () => {
    const { listeners, showNotification } = load();
    const { event, done } = pushEvent(dataOf(PAYLOAD));
    listeners.get("push")!(event);
    await done();
    expect(showNotification).toHaveBeenCalledWith("Power outage on Home world", expect.objectContaining({
      body: "Circuit 3 lost power.",
      tag: "alert:home:power_outage",
      data: { serverId: "home" },
    }));
  });

  it("still shows a generic notification for no data, bad JSON or a non-object (browsers require one)", async () => {
    for (const data of [null, undefined, { json: () => { throw new Error("bad"); } }, dataOf("text"), dataOf([1]), dataOf(null)]) {
      const { listeners, showNotification } = load();
      const { event, done } = pushEvent(data);
      listeners.get("push")!(event);
      await done();
      expect(showNotification).toHaveBeenCalledWith("Satis Manager", expect.objectContaining({ body: expect.any(String) }));
    }
  });

  it("clips long text and ignores fields of the wrong type", async () => {
    const { listeners, showNotification } = load();
    const { event, done } = pushEvent(dataOf({ title: "T".repeat(500), body: 7, serverId: { x: 1 }, kind: null }));
    listeners.get("push")!(event);
    await done();
    const [title, options] = showNotification.mock.calls[0] as unknown as [string, { body: string; tag: string }];
    expect(title).toHaveLength(120);
    expect(options.body).not.toBe("7");
    expect(options.tag).toBe("alert::");
  });

  it("on click closes the notification and focuses an open app window", async () => {
    const other: FakeClient = { url: "https://example.test/", focus: vi.fn() };
    const app: FakeClient = { url: "https://example.test/app/settings", focus: vi.fn(() => Promise.resolve()) };
    const { listeners, openWindow, matchAll } = load([other, app]);
    const close = vi.fn();
    const waits: Promise<unknown>[] = [];
    listeners.get("notificationclick")!({ notification: { close }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(close).toHaveBeenCalled();
    expect(matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    expect(app.focus).toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("on click opens /app when no window is open", async () => {
    const { listeners, openWindow } = load([]);
    const waits: Promise<unknown>[] = [];
    listeners.get("notificationclick")!({ notification: { close: vi.fn() }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(openWindow).toHaveBeenCalledWith("/app");
  });
});
