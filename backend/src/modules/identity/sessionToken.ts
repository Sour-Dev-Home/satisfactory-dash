import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ADR-0011: the session is a signed, expiring token carried only in an httpOnly
 * cookie -- never in a response body or localStorage. Format:
 *
 *   base64url(JSON { sub, exp }) "." base64url(HMAC-SHA256(SESSION_SECRET, payload))
 *
 * Stateless: nothing is stored server-side. The trade-off is that a session can't be
 * revoked before it expires except by rotating SESSION_SECRET (which signs everyone
 * out). Acceptable for one operator; revisit with multi-user accounts (ADR-0011).
 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

interface SessionPayload {
  sub: string;
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(subject: string, secret: string, nowMs: number = Date.now()): string {
  const payload: SessionPayload = { sub: subject, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

/** Returns the session's subject, or null for anything invalid, tampered or expired. */
export function verifySessionToken(token: string, secret: string, nowMs: number = Date.now()): string | null {
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
      typeof (payload as SessionPayload).exp !== "number"
    ) {
      return null;
    }
    const { sub, exp } = payload as SessionPayload;
    return exp > Math.floor(nowMs / 1000) ? sub : null;
  } catch {
    return null;
  }
}
