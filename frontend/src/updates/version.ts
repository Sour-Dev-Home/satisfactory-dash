/**
 * Version comparison for the update banners (ADR-0057 Decision 7). Semver-ish: `MAJOR.MINOR.PATCH`, an optional
 * `-prerelease`, and build metadata (`+ec24244.20261025`) that is accepted and ignored. A version that does not parse
 * is `null`, and callers show nothing for it rather than a false alarm.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a release. */
  pre: string[];
}

const VERSION = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): ParsedVersion | null {
  const m = VERSION.exec(text.trim());
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] === undefined ? [] : m[4].split(".") };
}

const NUMERIC = /^\d+$/;

function comparePre(a: string[], b: string[]): number {
  // A release is newer than any of its prereleases.
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] as string;
    const y = b[i] as string;
    if (x === y) continue;
    const xn = NUMERIC.test(x);
    const yn = NUMERIC.test(y);
    // Numeric identifiers sort below alphanumeric ones, and by value among themselves.
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

export function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePre(a.pre, b.pre);
}

/** -1, 0 or 1; `null` when either side is malformed. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return null;
  return compareParsed(pa, pb) as -1 | 0 | 1;
}

/** True only when both parse and `a` is older than `b`. */
export function isOlder(a: string, b: string): boolean {
  return compareVersions(a, b) === -1;
}

const COMPARATOR = /^(<=|>=|<|>|=)?(.+)$/;

function matchesComparator(version: ParsedVersion, token: string): boolean | null {
  const m = COMPARATOR.exec(token);
  const bound = m === null ? null : parseVersion(m[2] as string);
  if (m === null || bound === null) return null;
  const c = compareParsed(version, bound);
  switch (m[1]) {
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
    default:
      return c === 0;
  }
}

/**
 * Whether `version` is inside `range`: sets joined by ` || `, each set comparators joined by spaces (`<`, `<=`, `>`,
 * `>=`, `=`, or a bare version meaning `=`), e.g. `>=1.0.0 <1.2.3 || =2.0.0`. A malformed version or range is
 * `false`: an advisory that cannot be read must not raise an alarm. A prerelease is compared by plain precedence.
 */
export function versionInRange(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (v === null) return false;
  // Every set is read before any answer, so a malformed later set cannot be hidden by an earlier match.
  const results: boolean[] = [];
  for (const set of range.split("||")) {
    const tokens = set.trim().split(/\s+/);
    if (tokens[0] === "") return false;
    let all = true;
    for (const token of tokens) {
      const ok = matchesComparator(v, token);
      if (ok === null) return false;
      if (!ok) all = false;
    }
    results.push(all);
  }
  return results.some(Boolean);
}
