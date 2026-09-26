import { describe, expect, it } from "vitest";
import { isLoopbackHost, nonLoopbackServerIds } from "./connectionConfig.js";

// ADR-0030 amendment 1: the startup warning for environment-configured servers that are not on loopback.
describe("isLoopbackHost", () => {
  it.each(["localhost", "LOCALHOST", "api.localhost", "127.0.0.1", "127.9.9.9", "::1", "[::1]", "::ffff:127.0.0.1", " 127.0.0.1 "])(
    "%s is loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["192.168.1.20", "10.0.0.5", "172.16.4.4", "::ffff:10.0.0.5", "fd00::1", "169.254.1.1", "8.8.8.8", "gaming-pc.lan", "example.com", "", "128.0.0.1", "1270.0.0.1"])(
    "%s is not loopback (a LAN address, or a name that cannot be classified without DNS)",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("nonLoopbackServerIds", () => {
  const server = (id: string, host: string) => ({ id, config: { host } });

  it("names the ids of servers whose host is off this machine, and only the ids", () => {
    const ids = nonLoopbackServerIds([server("home", "localhost"), server("lan", "192.168.1.20"), server("named", "gaming-pc.lan"), server("v6", "::1")]);
    expect(ids).toEqual(["lan", "named"]);
    expect(JSON.stringify(ids)).not.toMatch(/192\.168|gaming-pc/);
  });

  it("is empty when every server is on loopback (no warning)", () => {
    expect(nonLoopbackServerIds([server("a", "127.0.0.1"), server("b", "localhost")])).toEqual([]);
    expect(nonLoopbackServerIds([])).toEqual([]);
  });
});
