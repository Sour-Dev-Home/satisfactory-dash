import { randomInt } from "node:crypto";

/** Unambiguous characters only (no 0/O, 1/I/L), so a name read aloud or in a screenshot is clear. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SHORT_SUFFIX = 4;
const LONG_SUFFIX = 8;
/** Tries at the short form before widening; 31^4 is about 920k, so a retry is rare. */
const SHORT_TRIES = 5;

const suffix = (length: number, pick: (max: number) => number): string =>
  Array.from({ length }, () => ALPHABET.charAt(pick(ALPHABET.length))).join("");

/**
 * ADR-0046 question 5: a new account's neutral display name, "Player-XXXX". It is random, so it can
 * never hold the email or any part of it. `taken` is asked for each candidate; the caller holds the
 * sign-up lock, so the answer can't change before the insert. After SHORT_TRIES collisions the suffix
 * widens to 8 characters, so the loop always ends.
 */
export async function generateDisplayName(
  taken: (name: string) => Promise<boolean>,
  pick: (max: number) => number = randomInt,
): Promise<string> {
  for (let attempt = 0; attempt < SHORT_TRIES; attempt += 1) {
    const name = `Player-${suffix(SHORT_SUFFIX, pick)}`;
    if (!(await taken(name))) {
      return name;
    }
  }
  for (;;) {
    const name = `Player-${suffix(LONG_SUFFIX, pick)}`;
    if (!(await taken(name))) {
      return name;
    }
  }
}
