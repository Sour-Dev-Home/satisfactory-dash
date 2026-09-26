/**
 * Whether a typed host is an IP literal that is NOT loopback (ADR-0030 amendment 1: only loopback
 * servers can be added until certificate pinning exists). A hostname can't be classified here: it
 * may resolve to 127.0.0.1, so it is never flagged and the backend's 422 decides. A hint only;
 * the backend enforces.
 */
export function isNonLoopbackIpLiteral(host: string): boolean {
  let value = host.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) value = mapped[1];

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return false; // Not an address; the backend rejects it.
    return octets[0] !== 127;
  }
  // IPv6: only a literal with a colon counts; "::1" (in any spelling) is loopback.
  if (!value.includes(":") || !/^[0-9a-f:.]+$/.test(value)) return false;
  return !isIpv6Loopback(value);
}

function isIpv6Loopback(value: string): boolean {
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const zeros = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const all = [...head, ...Array<string>(Math.max(zeros, 0)).fill("0"), ...tail];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return false;
  return all.slice(0, 7).every((g) => parseInt(g, 16) === 0) && parseInt(all[7], 16) === 1;
}
