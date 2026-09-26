import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * ADR-0030 decision 2: the address guard for servers this backend connects to directly. The
 * resolved address must be in the approved list and nothing else:
 *   allowed: 127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16;
 *   IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by its embedded IPv4;
 *   refused: everything else, including public addresses, link-local 169.254.0.0/16 (the metadata
 *   address 169.254.169.254 among them) and fe80::/10, 0.0.0.0/8, 100.64.0.0/10, multicast,
 *   broadcast, and IPv6 unique-local (fc00::/7).
 * A hostname is resolved and EVERY resolved address must pass; one address is pinned.
 */

function parseIPv4(address: string): [number, number, number, number] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

function isAllowedIPv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 127 || // 127.0.0.0/8
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) // 192.168.0.0/16
  );
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not a plain address (a zone id is refused). */
function parseIPv6(address: string): number[] | null {
  if (isIP(address) !== 6 || address.includes("%")) return null;
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  }
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/** True only for an address in the approved list (see the top of this file). Anything else, or a
 *  string that is not an IP address at all, is refused. */
export function isAllowedAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4 !== null) return isAllowedIPv4(v4);
  const g = parseIPv6(address);
  if (g === null) return false;
  const leadingZeros = g.slice(0, 5).every((group) => group === 0);
  if (leadingZeros && g[5] === 0 && g[6] === 0 && g[7] === 1) return true; // ::1
  if (leadingZeros && g[5] === 0xffff) {
    return isAllowedIPv4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]); // ::ffff:a.b.c.d
  }
  return false;
}

/** True for loopback only (127/8, ::1, and IPv4-mapped 127/8): the one case where FRM's plain HTTP
 *  and its token never leave this machine. Any other allowed address is on the LAN. */
export function isLoopbackAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4 !== null) return v4[0] === 127;
  const g = parseIPv6(address);
  if (g === null) return false;
  const leadingZeros = g.slice(0, 5).every((group) => group === 0);
  if (leadingZeros && g[5] === 0 && g[6] === 0 && g[7] === 1) return true;
  return leadingZeros && g[5] === 0xffff && g[6]! >> 8 === 127;
}

/** The host cannot be used: it did not resolve, or an address it resolves to is not allowed. The
 *  message never names the address (this can be the operator probing their own network). */
export class AddressRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressRefusedError";
  }
}

export type AddressLookup = (host: string) => Promise<string[]>;

const systemLookup: AddressLookup = async (host) => (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Resolves `host` (an IP literal is used as is; `[::1]` brackets are accepted) and returns the
 * address to pin. EVERY resolved address must be allowed: a hostname that resolves to a mix
 * (DNS rebinding, or a public address behind a private name) is refused outright. IPv4 is pinned
 * before IPv6 when both are allowed (a game server listens on IPv4 by default; `localhost` often
 * lists ::1 first). Callers connect to the returned address, never to the hostname again, and
 * re-run this on every connect and edit.
 */
export async function resolveAllowedAddress(host: string, resolve: AddressLookup = systemLookup): Promise<string> {
  const name = host.trim().replace(/^\[|\]$/g, "");
  if (name.length === 0) throw new AddressRefusedError("The host is empty.");
  let addresses: string[];
  if (isIP(name) !== 0) {
    addresses = [name];
  } else {
    try {
      addresses = await resolve(name);
    } catch {
      throw new AddressRefusedError("The host could not be resolved.");
    }
  }
  if (addresses.length === 0) throw new AddressRefusedError("The host did not resolve to any address.");
  if (!addresses.every(isAllowedAddress)) {
    throw new AddressRefusedError("The host resolves to an address that is not loopback or private.");
  }
  return [...addresses].sort((a, b) => Number(isIP(a) === 6) - Number(isIP(b) === 6))[0]!;
}
