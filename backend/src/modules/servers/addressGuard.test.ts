import { describe, expect, it } from "vitest";
import { AddressRefusedError, isAllowedAddress, resolveAllowedAddress } from "./addressGuard.js";

describe("isAllowedAddress: the allowed list", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    "::1",
    "0:0:0:0:0:0:0:1",
    "0000:0000:0000:0000:0000:0000:0000:0001",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.20",
    "::ffff:10.1.2.3",
    "::ffff:c0a8:0114", // ::ffff:192.168.1.20 in hex form
    "::FFFF:172.16.5.5",
    "0:0:0:0:0:ffff:7f00:1",
  ])("allows %s", (address) => {
    expect(isAllowedAddress(address)).toBe(true);
  });
});

describe("isAllowedAddress: everything else is refused", () => {
  it.each([
    // public
    ["8.8.8.8", "public"],
    ["1.1.1.1", "public"],
    ["2001:4860:4860::8888", "public IPv6"],
    // link-local, including the cloud metadata address
    ["169.254.169.254", "metadata"],
    ["169.254.0.1", "link-local"],
    ["fe80::1", "IPv6 link-local"],
    ["febf::1", "IPv6 link-local (top of fe80::/10)"],
    ["fe80::1%eth0", "link-local with a zone id"],
    // "this network", CGNAT, multicast, broadcast, reserved
    ["0.0.0.0", "0/8"],
    ["0.1.2.3", "0/8"],
    ["100.64.0.1", "CGNAT"],
    ["100.127.255.255", "CGNAT"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["ff02::1", "IPv6 multicast"],
    ["255.255.255.255", "broadcast"],
    ["240.0.0.1", "reserved"],
    // neighbours of the allowed ranges
    ["172.15.255.255", "just below 172.16/12"],
    ["172.32.0.0", "just above 172.16/12"],
    ["192.167.1.1", "not 192.168/16"],
    ["192.169.1.1", "not 192.168/16"],
    ["11.0.0.1", "not 10/8"],
    ["126.255.255.255", "not 127/8"],
    ["128.0.0.1", "not 127/8"],
    // IPv6 forms that are not loopback or mapped-private
    ["::", "unspecified"],
    ["fc00::1", "ULA"],
    ["fd12:3456:789a::1", "ULA"],
    ["::2", "not ::1"],
    ["::ffff:8.8.8.8", "mapped public"],
    ["::ffff:169.254.169.254", "mapped metadata"],
    ["::ffff:0.0.0.0", "mapped 0/8"],
    ["::ffff:255.255.255.255", "mapped broadcast"],
    ["::192.168.1.1", "IPv4-compatible (not mapped)"],
    ["64:ff9b::c0a8:101", "NAT64 of a private address"],
    ["2002:c0a8:101::1", "6to4 of a private address"],
    ["1::ffff:192.168.1.1", "mapped form with a non-zero prefix"],
    // not addresses at all
    ["", "empty"],
    ["localhost", "a hostname"],
    ["192.168.1", "short IPv4"],
    ["192.168.1.1.1", "long IPv4"],
    ["192.168.1.256", "octet out of range"],
    ["0x7f.0.0.1", "hex octet"],
    ["2130706433", "decimal integer form"],
    ["010.0.0.1", "leading zero"],
    [" 127.0.0.1", "leading space"],
    ["127.0.0.1 ", "trailing space"],
    ["[::1]", "brackets"],
    ["::1::", "two compressions"],
  ])("refuses %s (%s)", (address) => {
    expect(isAllowedAddress(address)).toBe(false);
  });
});

describe("resolveAllowedAddress", () => {
  const never: (host: string) => Promise<string[]> = async () => {
    throw new Error("should not resolve");
  };
  const returning = (...addresses: string[]) => async () => addresses;

  it("uses an allowed IP literal as is, without resolving (brackets accepted)", async () => {
    expect(await resolveAllowedAddress("192.168.1.20", never)).toBe("192.168.1.20");
    expect(await resolveAllowedAddress("[::1]", never)).toBe("::1");
    expect(await resolveAllowedAddress("  10.0.0.5 ", never)).toBe("10.0.0.5");
  });

  it("refuses a literal that is not allowed, without resolving", async () => {
    await expect(resolveAllowedAddress("8.8.8.8", never)).rejects.toThrow(AddressRefusedError);
    await expect(resolveAllowedAddress("169.254.169.254", never)).rejects.toThrow(AddressRefusedError);
  });

  it("resolves a hostname and pins an allowed address", async () => {
    expect(await resolveAllowedAddress("gaming-pc.lan", returning("192.168.1.20"))).toBe("192.168.1.20");
  });

  it("refuses a hostname that resolves to a MIX of allowed and refused addresses (rebinding)", async () => {
    await expect(resolveAllowedAddress("evil.example", returning("192.168.1.20", "8.8.8.8"))).rejects.toThrow(AddressRefusedError);
    await expect(resolveAllowedAddress("evil.example", returning("8.8.8.8", "192.168.1.20"))).rejects.toThrow(AddressRefusedError);
    await expect(resolveAllowedAddress("evil.example", returning("127.0.0.1", "::ffff:169.254.169.254"))).rejects.toThrow(AddressRefusedError);
  });

  it("refuses a hostname that resolves only to refused addresses, or to none, or fails to resolve", async () => {
    await expect(resolveAllowedAddress("public.example", returning("93.184.216.34"))).rejects.toThrow(/not loopback or private/);
    await expect(resolveAllowedAddress("empty.example", returning())).rejects.toThrow(/any address/);
    await expect(resolveAllowedAddress("gone.example", never)).rejects.toThrow(/could not be resolved/);
    await expect(resolveAllowedAddress("", never)).rejects.toThrow(AddressRefusedError);
  });

  it("pins IPv4 before IPv6 when a name resolves to both (localhost often lists ::1 first)", async () => {
    expect(await resolveAllowedAddress("localhost", returning("::1", "127.0.0.1"))).toBe("127.0.0.1");
    expect(await resolveAllowedAddress("localhost", returning("::1"))).toBe("::1");
  });

  it("never names an address in the error", async () => {
    let message = "";
    try {
      await resolveAllowedAddress("evil.example", returning("10.1.2.3", "203.0.113.9"));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("203.0.113.9");
    expect(message).not.toContain("10.1.2.3");
  });
});
