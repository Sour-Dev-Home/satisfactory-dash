import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { ipv6Prefix64, rateLimitKey } from "./clientKey.js";

const req = (address: string) => ({ socket: { remoteAddress: address }, headers: {} }) as unknown as IncomingMessage;

describe("ipv6Prefix64", () => {
  it.each([
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2"],
    ["2001:db8::1", "2001:db8:0:0"],
    ["2001:0db8:0000:0001:aaaa:bbbb:cccc:dddd", "2001:db8:0:1"],
    ["::1", "0:0:0:0"],
    ["fe80::", "fe80:0:0:0"],
    ["2001:db8:1::5:6", "2001:db8:1:0"],
  ])("%s -> %s", (address, prefix) => {
    expect(ipv6Prefix64(address)).toBe(prefix);
  });

  it("is undefined for IPv4 and for IPv4-mapped addresses", () => {
    expect(ipv6Prefix64("203.0.113.9")).toBeUndefined();
    expect(ipv6Prefix64("::ffff:203.0.113.9")).toBeUndefined();
    expect(ipv6Prefix64("unknown")).toBeUndefined();
  });
});

describe("rateLimitKey", () => {
  it("gives every address in one /64 the same key, and another /64 another", () => {
    expect(rateLimitKey(req("2001:db8:1:2::1"))).toBe(rateLimitKey(req("2001:db8:1:2:dead:beef:0:9")));
    expect(rateLimitKey(req("2001:db8:1:2::1"))).not.toBe(rateLimitKey(req("2001:db8:1:3::1")));
  });

  it("keeps an IPv4 address as it is", () => {
    expect(rateLimitKey(req("203.0.113.9"))).toBe("203.0.113.9");
  });
});
