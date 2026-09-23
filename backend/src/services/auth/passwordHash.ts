import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

/**
 * ADR-0011: the operator's password is stored only as a scrypt hash (node:crypto, no
 * native modules, so the esbuild bundle still works). The encoded form carries its own
 * parameters, so they can be raised later without invalidating existing hashes:
 *
 *   scrypt$<N>$<r>$<p>$<salt, base64>$<hash, base64>
 *
 * Generate one with `npm run hash-password -w backend`.
 */
const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// scrypt needs about 128 * N * r bytes; the default 32 MiB cap is exactly N=2^15, r=8.
const MAX_MEMORY = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** Parses an encoded hash, or returns null if it isn't one. Used at startup so a
 *  malformed DASHBOARD_ADMIN_PASSWORD_HASH fails fast instead of at first login. */
export function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  const parts = encoded.trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return null;
  }
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const hash = Buffer.from(parts[5], "base64");
  const powerOfTwo = Number.isInteger(N) && N >= 2 ** 14 && (N & (N - 1)) === 0;
  if (!powerOfTwo || !Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1) {
    return null;
  }
  if (salt.length < SALT_BYTES || hash.length < 32) {
    return null;
  }
  return { N, r, p, salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, KEY_LENGTH, { ...DEFAULT_PARAMS, maxmem: MAX_MEMORY });
  const { N, r, p } = DEFAULT_PARAMS;
  return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join("$");
}

/** Constant-time comparison of a candidate password against a parsed hash. */
export async function verifyPassword(password: string, stored: ParsedPasswordHash): Promise<boolean> {
  const candidate = await scrypt(password, stored.salt, stored.hash.length, {
    N: stored.N,
    r: stored.r,
    p: stored.p,
    maxmem: MAX_MEMORY,
  });
  return timingSafeEqual(candidate, stored.hash);
}
