import { createDecipheriv, createECDH, createHmac, createPublicKey, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptPushPayload, PushCryptoError, RECORD_SIZE, vapidAuthorization, VAPID_TOKEN_SECONDS } from "./webPushCrypto.js";

// RFC 8291 section 5 and appendix A: the worked example, byte for byte.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  receiverPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  receiverPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const b64 = (value: string) => Buffer.from(value, "base64url");
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** A receiver-side decryption written straight from RFC 8291 section 3, to round-trip random messages. */
function decrypt(body: Buffer, receiverPrivate: Buffer, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const senderPublic = body.subarray(21, 21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(receiverPrivate);
  const secret = ecdh.computeSecret(senderPublic);
  const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), senderPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const record = body.subarray(21 + idlen);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  expect(padded[padded.length - 1]).toBe(2);
  return padded.subarray(0, -1);
}

describe("RFC 8291 encryption", () => {
  it("reproduces the RFC 8291 section 5 example exactly", () => {
    const body = encryptPushPayload({
      plaintext: Buffer.from(RFC.plaintext),
      p256dh: RFC.receiverPublic,
      auth: RFC.auth,
      fixed: { salt: b64(RFC.salt), senderPrivateKey: b64(RFC.senderPrivate) },
    });
    expect(body.toString("base64url")).toBe(RFC.body);
    expect(body.readUInt32BE(16)).toBe(RECORD_SIZE);
  });

  it("round-trips a random message with fresh keys and a fresh salt each time", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = randomBytes(16);
    const plaintext = randomBytes(3000);
    const input = { plaintext, p256dh: receiver.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
    const a = encryptPushPayload(input);
    const b = encryptPushPayload(input);
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false); // salt
    expect(a.subarray(21, 86).equals(b.subarray(21, 86))).toBe(false); // ephemeral key
    expect(decrypt(a, receiver.getPrivateKey(), auth).equals(plaintext)).toBe(true);
  });

  it("refuses bad keys and oversize plaintext with a stable code that carries no key", () => {
    const ok = { p256dh: RFC.receiverPublic, auth: RFC.auth };
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(PushCryptoError);
        expect((err as Error).message).not.toContain(RFC.auth);
        return (err as PushCryptoError).code;
      }
      return "no error";
    };
    expect(code(() => encryptPushPayload({ ...ok, plaintext: Buffer.from("x"), p256dh: "B".repeat(87) }))).toBe("bad_p256dh"); // right length, not a point
    expect(code(() => encryptPushPayload({ ...ok, plaintext: Buffer.from("x"), p256dh: "short" }))).toBe("bad_p256dh");
    expect(code(() => encryptPushPayload({ ...ok, plaintext: Buffer.from("x"), auth: "C".repeat(10) }))).toBe("bad_auth");
    expect(code(() => encryptPushPayload({ ...ok, plaintext: Buffer.alloc(RECORD_SIZE) }))).toBe("too_large");
  });
});

describe("RFC 8292 VAPID", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), b64(jwk.x!), b64(jwk.y!)]).toString("base64url");
  const keys = { publicKey: pub, subject: "mailto:ops@example.test", privateKey: () => jwk.d! };

  it("signs an ES256 token for the endpoint's origin that verifies with the public key", () => {
    const now = Date.UTC(2026, 9, 20, 12, 0, 0);
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc?x=1", keys, now);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(pub);
    expect(JSON.parse(b64(h!).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(b64(c!).toString())).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + VAPID_TOKEN_SECONDS, sub: keys.subject });
    expect(VAPID_TOKEN_SECONDS).toBeLessThanOrEqual(24 * 3600);
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: createPublicKey(publicKey.export({ format: "pem", type: "spki" })), dsaEncoding: "ieee-p1363" }, b64(s!))).toBe(true);
    // The token never carries the private key or the endpoint's path.
    expect(header).not.toContain(jwk.d!);
    expect(header).not.toContain("abc");
  });

  it("refuses a malformed key with a stable code", () => {
    expect(() => vapidAuthorization("https://a.example", { ...keys, privateKey: () => "short" }, 0)).toThrow(PushCryptoError);
  });
});
