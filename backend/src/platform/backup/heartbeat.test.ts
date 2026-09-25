import { describe, it, expect } from "vitest";
import { ConfigError } from "../errors.js";
import { HEARTBEAT_TIMEOUT_MS, loadHeartbeatUrl, pingAfterUpload, pingHeartbeat } from "./heartbeat.js";
import type { Fetch } from "./heartbeat.js";

const URL_WITH_TOKEN = "https://uptime.betterstack.com/api/v1/heartbeat/SECRETTOKEN123";

describe("loadHeartbeatUrl", () => {
  it("is off when unset or blank", () => {
    expect(loadHeartbeatUrl({})).toBeUndefined();
    expect(loadHeartbeatUrl({ BACKUP_HEARTBEAT_URL: "   " })).toBeUndefined();
  });

  it("returns a valid https URL", () => {
    expect(loadHeartbeatUrl({ BACKUP_HEARTBEAT_URL: URL_WITH_TOKEN })).toBe(URL_WITH_TOKEN);
  });

  it.each([
    ["not a URL", "not a url SECRETTOKEN123"],
    ["plain http", "http://uptime.betterstack.com/api/v1/heartbeat/SECRETTOKEN123"],
    ["embedded credentials", "https://user:SECRETTOKEN123@uptime.betterstack.com/x"],
    ["another scheme", "ftp://uptime.betterstack.com/SECRETTOKEN123"],
  ])("rejects %s with a ConfigError that never echoes the value", (_name, value) => {
    let message = "";
    try {
      loadHeartbeatUrl({ BACKUP_HEARTBEAT_URL: value });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      message = (err as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("SECRETTOKEN123");
  });
});

describe("pingAfterUpload", () => {
  const ok: Fetch = async () => ({ ok: true, status: 200 });

  it("pings only after a real upload, and only when a URL is configured", async () => {
    let calls = 0;
    const fetchImpl: Fetch = async (...args) => {
      calls++;
      return ok(...args);
    };
    const log = () => {};
    await expect(pingAfterUpload(true, URL_WITH_TOKEN, { fetchImpl, log })).resolves.toBe(true);
    await expect(pingAfterUpload(false, URL_WITH_TOKEN, { fetchImpl, log })).resolves.toBeUndefined(); // local-only trial run
    await expect(pingAfterUpload(true, undefined, { fetchImpl, log })).resolves.toBeUndefined(); // not configured
    expect(calls).toBe(1);
  });

  it("never throws, even when the ping fails: the backup itself stays a success", async () => {
    const fetchImpl: Fetch = async () => {
      throw new TypeError("down");
    };
    await expect(pingAfterUpload(true, URL_WITH_TOKEN, { fetchImpl, log: () => {} })).resolves.toBe(false);
  });
});

describe("pingHeartbeat", () => {
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const never = (text: string) => expect(logs.join("\n")).not.toContain(text);

  it("GETs the URL with a timeout signal and no redirect following, and reports success", async () => {
    logs.length = 0;
    const seen: { url: string; method: string; redirect: string; aborted: boolean }[] = [];
    const fetchImpl: Fetch = async (url, init) => {
      seen.push({ url, method: init.method, redirect: init.redirect, aborted: init.signal.aborted });
      return { ok: true, status: 200 };
    };
    await expect(pingHeartbeat(URL_WITH_TOKEN, { fetchImpl, log })).resolves.toBe(true);
    expect(seen).toEqual([{ url: URL_WITH_TOKEN, method: "GET", redirect: "error", aborted: false }]);
    expect(logs).toEqual(["heartbeat sent"]);
  });

  it("a non-2xx answer is logged and returns false, without throwing, and without the URL", async () => {
    logs.length = 0;
    const fetchImpl: Fetch = async () => ({ ok: false, status: 404 });
    await expect(pingHeartbeat(URL_WITH_TOKEN, { fetchImpl, log })).resolves.toBe(false);
    expect(logs[0]).toContain("HTTP 404");
    never("SECRETTOKEN123");
    never("betterstack");
  });

  it("a network error never throws, and neither the URL nor the error text is logged", async () => {
    logs.length = 0;
    const fetchImpl: Fetch = async () => {
      throw new TypeError("fetch failed: getaddrinfo ENOTFOUND uptime.betterstack.com/SECRETTOKEN123");
    };
    await expect(pingHeartbeat(URL_WITH_TOKEN, { fetchImpl, log })).resolves.toBe(false);
    expect(logs[0]).toContain("network error");
    never("SECRETTOKEN123");
    never("ENOTFOUND");
  });

  it("times out (10 s by default) instead of hanging the backup, and says so", async () => {
    logs.length = 0;
    expect(HEARTBEAT_TIMEOUT_MS).toBe(10_000);
    const fetchImpl: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    await expect(pingHeartbeat(URL_WITH_TOKEN, { fetchImpl, log, timeoutMs: 20 })).resolves.toBe(false);
    expect(logs[0]).toContain("timed out");
    never("SECRETTOKEN123");
  });
});
