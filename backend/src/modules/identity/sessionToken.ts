import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ADR-0011: the session is a signed, expiring token carried only in an httpOnly
 * cookie -- never in a response body or localStorage. Format:
 *
 *   base64url(JSON { sub, exp, jti }) "." base64url(HMAC-SHA256(SESSION_SECRET, payload))
 *
 * Stateless apart from logout: `jti` is a random session id that logout adds to an
 * in-memory denylist (sessionDenylist.ts) until the token expires. A restart forgets the
 * denylist, and rotating SESSION_SECRET signs everyone out (the emergency revoke-all).
 * Acceptable for one operator on one process; server-side sessions replace this when
 * either grows (ADR-0019).
 */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface SessionPayload {
  sub: string;
  exp: number;
  jti: string;
}

/** A verified session: who it is for, its id, and when it expires (epoch seconds). */
export interface VerifiedSession {
  sub: string;
  jti: string;
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(subject: string, secret: string, nowMs: number = Date.now()): string {
  const payload: SessionPayload = {
    sub: subject,
    exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS,
    jti: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

/** Returns the session's subject, or null for anything invalid, tampered or expired. */
export function verifySessionToken(token: string, secret: string, nowMs: number = Date.now()): string | null {
  return readSessionToken(token, secret, nowMs)?.sub ?? null;
}

/**
 * The verified session behind a token, or null for anything invalid, tampered, expired
 * or issued without a session id (tokens from before ADR-0019 have none, so their
 * holders sign in again once).
 */
export function readSessionToken(token: string, secret: string, nowMs: number = Date.now()): VerifiedSession | null {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined) {
    return null;
  }
  const expected = Buffer.from(sign(encoded, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const payload: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as SessionPayload).sub !== "string" ||
      typeof (payload as SessionPayload).exp !== "number" ||
      typeof (payload as SessionPayload).jti !== "string" ||
      (payload as SessionPayload).jti.length === 0
    ) {
      return null;
    }
    const { sub, exp, jti } = payload as SessionPayload;
    return exp > Math.floor(nowMs / 1000) ? { sub, jti, exp } : null;
  } catch {
    return null;
  }
}
