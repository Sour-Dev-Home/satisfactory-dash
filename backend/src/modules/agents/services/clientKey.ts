import type { IncomingMessage } from "node:http";
import { isIPv6 } from "node:net";
import { clientIp } from "../../../platform/clientIp.js";

/** The first 64 bits of an IPv6 address, as four hex groups ("2001:db8:0:0"). Undefined when it is not plain IPv6. */
export function ipv6Prefix64(address: string): string | undefined {
  if (!isIPv6(address) || address.toLowerCase().startsWith("::ffff:")) return undefined;
  const [head = "", tail] = address.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array.from({ length: missing }, () => "0"), ...tailGroups];
  return groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(":");
}

/**
 * The key a public agent route rate-limits a caller under: the client address, but an IPv6 address counts as its /64
 * (one subscriber is handed a whole /64, so per-address keys would let one machine mint billions of keys and never be
 * limited). An IPv4 address, and the placeholder for an unknown one, are used as they are.
 */
export function rateLimitKey(req: IncomingMessage): string {
  const ip = clientIp(req);
  const prefix = ipv6Prefix64(ip);
  return prefix === undefined ? ip : `${prefix}::/64`;
}
