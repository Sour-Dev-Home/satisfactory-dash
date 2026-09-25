import { describe, expect, it, vi } from "vitest";
import { isAllowedAddress, resolveAllowedAddress } from "./addressGuard.js";
import { ServerRuntime } from "./serverRuntime.js";

describe("addressGuard odd forms (test-hunter)", () => {
  it.each([
    "::ffff:8.8.8.8", "::ffff:808:808", "0:0:0:0:0:ffff:808:808", "::8.8.8.8", "::127.0.0.1", "::ffff:0:127.0.0.1",
    "64:ff9b::7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:100.64.0.1", "2002:7f00:1::1", "::",
    "::2", "0:0:0:0:0:0:0:0", "::1%lo", "fe80::1%eth0", "::ffff:127.0.0.1%eth0", "1::1", "::ffff:0.0.0.0", "::ffff:224.0.0.1",
    "::ffff:172.32.0.1", "::ffff:192.169.0.1", "172.15.255.255", "172.32.0.0", "192.167.1.1", "9.255.255.255", "11.0.0.0",
    "127.0.0.1 ", " 127.0.0.1", "127.0.0.1\n", "::1\0", "0x7f.0.0.1", "127.1", "2130706433", "0177.0.0.1",
  ])("refuses %j", (a) => {
    expect(isAllowedAddress(a)).toBe(false);
  });
  it.each(["::ffff:7f00:1", "0:0:0:0:0:ffff:c0a8:1", "::ffff:10.1.2.3", "0000:0000:0000:0000:0000:0000:0000:0001", "::FFFF:172.31.255.255", "172.16.0.0"])(
    "allows %j",
    (a) => expect(isAllowedAddress(a)).toBe(true),
  );
  it("refuses a hostname that lists one bad address among good ones, and never names it", async () => {
    await expect(resolveAllowedAddress("x", async () => ["10.0.0.1", "8.8.8.8"])).rejects.toThrow(/not loopback or private/);
    await expect(resolveAllowedAddress("x", async () => ["10.0.0.1", "8.8.8.8"])).rejects.not.toThrow(/8\.8\.8\.8/);
  });
  it("brackets, whitespace and empties", async () => {
    await expect(resolveAllowedAddress(" [::1] ")).resolves.toBe("::1");
    await expect(resolveAllowedAddress("[]")).rejects.toThrow();
    await expect(resolveAllowedAddress("[[::1]]", async () => [])).rejects.toThrow();
    await expect(resolveAllowedAddress("[::1%lo]")).rejects.toThrow();
  });
});

const entry = (id: string, workers: { start(): void; stop(): Promise<void> }[]) => ({ id, displayName: id, services: id, workers });

describe("ServerRuntime failure paths (test-hunter)", () => {
  it("a worker whose stop() throws synchronously does not stop the others being stopped on remove", async () => {
    const stopped = vi.fn();
    const bad = { start() {}, stop: (): Promise<void> => { throw new Error("sync"); } };
    const good = { start() {}, stop: async () => void stopped() };
    const rt = new ServerRuntime([entry("a", [bad, good])]);
    await expect(rt.remove("a")).resolves.toBe(true);
    expect(stopped).toHaveBeenCalledTimes(1);
  });
  it("stop() with a synchronously throwing worker still stops the others and resolves", async () => {
    const stopped = vi.fn();
    const bad = { start() {}, stop: (): Promise<void> => { throw new Error("sync"); } };
    const good = { start() {}, stop: async () => void stopped() };
    const rt = new ServerRuntime([entry("a", [bad]), entry("b", [good])]);
    rt.start();
    await expect(rt.stop()).resolves.toBeUndefined();
    expect(stopped).toHaveBeenCalledTimes(1);
  });
  it("a server added after stop() is not started", async () => {
    const start = vi.fn();
    const rt = new ServerRuntime<string>();
    rt.start();
    await rt.stop();
    rt.add(entry("late", [{ start, stop: async () => {} }]));
    expect(start).not.toHaveBeenCalled();
  });
});
