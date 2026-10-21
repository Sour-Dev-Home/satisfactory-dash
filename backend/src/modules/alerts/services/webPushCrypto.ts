import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";

/**
 * ADR-0044 (#348, task 348-2): the two pieces of cryptography web push needs, on node:crypto alone (no new dependency:
 * adding one needs the owner's OK, and these are two short, fully specified algorithms with published test vectors).
 *
 * - RFC 8291 message encryption, `aes128gcm` content coding (RFC 8188), one record: an ephemeral P-256 key pair per
 *   message, ECDH with the browser's `p256dh` key, HKDF-SHA-256 keyed by the browser's `auth` secret, AES-128-GCM.
 * - RFC 8292 VAPID: an ES256 JWT (`aud` = the endpoint's origin, `exp` at most 24 h ahead, `sub` = the operator contact)
 *   sent as `Authorization: vapid t=<jwt>, k=<public key>`.
 *
 * Nothing here logs, and no error carries a key or the plaintext: a refusal is a stable `PushCryptoError` code.
 */

export class PushCryptoError extends Error {
  constructor(readonly code: "bad_p256dh" | "bad_auth" | "too_large" | "bad_vapid_key") {
    super(`web push crypto: ${code}`);
    this.name = "PushCryptoError";
  }
}

/** The record size written in the header. The whole message is one record, so it only has to exceed the ciphertext. */
export const RECORD_SIZE = 4096;
/** RFC 8188 record overhead: the padding delimiter (1) and the GCM tag (16). */
const RECORD_OVERHEAD = 17;
/** Header: salt (16), rs (4), idlen (1), keyid = the sender's public key (65). */
const HEADER_LENGTH = 86;

const hmac = (key: Buffer, data: Buffer): Buffer => createHmac("sha256", key).update(data).digest();

/** HKDF-Expand for one block (length <= 32), RFC 5869. */
const expand = (prk: Buffer, info: Buffer, length: number): Buffer => hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

export interface EncryptInput {
  plaintext: Buffer;
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** The browser's auth secret, base64url (16 bytes). */
  auth: string;
  /** Test vectors only: a fixed salt and a fixed sender private key. Production always generates both. */
  fixed?: { salt: Buffer; senderPrivateKey: Buffer };
}

function decodeExact(value: string, length: number): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === length ? bytes : undefined;
}

/** RFC 8291 section 3 and 4: the full `aes128gcm` body (header followed by the one encrypted record). */
export function encryptPushPayload(input: EncryptInput): Buffer {
  const uaPublic = decodeExact(input.p256dh, 65);
  if (uaPublic === undefined || uaPublic[0] !== 0x04) throw new PushCryptoError("bad_p256dh");
  const authSecret = decodeExact(input.auth, 16);
  if (authSecret === undefined) throw new PushCryptoError("bad_auth");
  if (input.plaintext.length + RECORD_OVERHEAD > RECORD_SIZE - HEADER_LENGTH) throw new PushCryptoError("too_large");

  const sender = createECDH("prime256v1");
  if (input.fixed !== undefined) sender.setPrivateKey(input.fixed.senderPrivateKey);
  else sender.generateKeys();
  const asPublic = sender.getPublicKey();
  let ecdhSecret: Buffer;
  try {
    ecdhSecret = sender.computeSecret(uaPublic);
  } catch {
    throw new PushCryptoError("bad_p256dh"); // not a point on the curve
  }

  // RFC 8291 section 3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32).
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]);
  const ikm = expand(prkKey, keyInfo, 32);

  // RFC 8188 section 2.2 and 2.3: the content-encryption key and the nonce, from a random salt.
  const salt = input.fixed?.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12);

  // One record, so it is the last one: the padding delimiter is 0x02 and no padding follows.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([input.plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ciphertext]);
}

/** The shape of `VapidConfig` (pushConfig.ts): the private key is a function, so it never shows up when serialised. */
export interface VapidKeys {
  /** base64url, 65 bytes uncompressed. */
  publicKey: string;
  /** base64url, 32 bytes. */
  privateKey(): string;
  subject: string;
}

/** How long a VAPID token is valid for (RFC 8292 section 2: at most 24 hours). */
export const VAPID_TOKEN_SECONDS = 12 * 60 * 60;

const signingKeys = new WeakMap<object, KeyObject>();

function signingKey(keys: VapidKeys): KeyObject {
  const cached = signingKeys.get(keys);
  if (cached !== undefined) return cached;
  const pub = decodeExact(keys.publicKey, 65);
  const d = decodeExact(keys.privateKey(), 32);
  if (pub === undefined || d === undefined || pub[0] !== 0x04) throw new PushCryptoError("bad_vapid_key");
  let key: KeyObject;
  try {
    key = createPrivateKey({
      key: { kty: "EC", crv: "P-256", d: d.toString("base64url"), x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") },
      format: "jwk",
    });
  } catch {
    throw new PushCryptoError("bad_vapid_key");
  }
  signingKeys.set(keys, key);
  return key;
}

const b64json = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** RFC 8292: the `Authorization` header value for one push request to `endpoint`'s origin. The parsed signing key is
 *  cached per keys object (the config lives for the process), so the private key is parsed once. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, nowMs: number): string {
  const audience = new URL(endpoint).origin;
  const header = b64json({ typ: "JWT", alg: "ES256" });
  const claims = b64json({ aud: audience, exp: Math.floor(nowMs / 1000) + VAPID_TOKEN_SECONDS, sub: keys.subject });
  const signingInput = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key: signingKey(keys), dsaEncoding: "ieee-p1363" });
  return `vapid t=${signingInput}.${signature.toString("base64url")}, k=${keys.publicKey}`;
}
