import { randomBytes } from "node:crypto";

/** RFC 4648 base32 (A-Z, 2-7): no 0, 1, 8 or 9, so a code read aloud or off a screen is hard to mistype. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A fresh enrolment code `XXXX-XXXX`: 8 base32 characters = 40 random bits. 256 is a multiple of 32, so a byte's low
 *  5 bits are uniform and there is no modulo bias. */
export function generateEnrollmentCode(): string {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (byte) => ALPHABET[byte & 31]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** A fresh agent secret: 256 random bits, base64url (43 characters, no padding). Shown once, stored only as a hash. */
export function generateAgentSecret(): string {
  return randomBytes(32).toString("base64url");
}
