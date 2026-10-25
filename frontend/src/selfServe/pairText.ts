import { EnrollmentCodeSchema } from "@satisfactory-dash/shared";
import { ApiError } from "../api/errors";
import { retryText } from "./selfServeText";

// ADR-0051 section 1 + ADR-0057 D6: the /pair page's words and small rules.

/** Where the person finds the code. */
export const CODE_WHERE = "in your server's console or log (FactoryGame.log), or in pairing.txt next to the mod";

export const CODE_EXAMPLE = "AB3D-7XQ2-K5MN";

/** The one answer to a code the backend does not accept: it never says why (unknown, expired, spent, someone else's). */
export const INVALID_CODE_TEXT = "That code isn't valid. Check it, or restart the server for a new one.";

/**
 * The code as the person types it: upper case, anything but letters and digits dropped (dashes and spaces
 * included), at most 12 characters, in groups of four. A group's dash appears with its first character, so
 * backspace never fights the formatting.
 */
export function formatCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return (clean.match(/.{1,4}/g) ?? []).join("-");
}

/** A problem with the typed code that needs no backend, or undefined when it has the right shape. */
export function codeProblem(formatted: string): string | undefined {
  if (formatted === "") return "Enter the code from your server.";
  if (!EnrollmentCodeSchema.safeParse(formatted).success) {
    return `A code has 12 letters and digits in three groups, like ${CODE_EXAMPLE}. It never contains 0, 1, 8 or 9.`;
  }
  return undefined;
}

/** "asked 3 minutes ago": an age as text only (the backend decides when a code has expired). */
export function askedText(requestedAt: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - Date.parse(requestedAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "asked just now";
  return minutes === 1 ? "asked 1 minute ago" : `asked ${minutes} minutes ago`;
}

export interface PairError {
  text: string;
  /** An expected refusal (a wait, a cap): warn style, not red. */
  limit: boolean;
}

/** Words for a refused lookup or approval, or undefined for ErrorNotice (network, drift, a 5xx). 401 is handled centrally. */
export function pairErrorText(error: unknown): PairError | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 404 || error.code === "not_found") return { text: INVALID_CODE_TEXT, limit: false };
  if (error.status === 429 || error.code === "rate_limited") {
    const wait = !error.retryAfterSeconds || error.retryAfterSeconds <= 0 ? "a little while" : retryText(error.retryAfterSeconds).replace(/^in /, "");
    return { text: `Too many tries. Wait ${wait}, then try again.`, limit: true };
  }
  if (error.code === "server_limit_reached") return { text: error.message, limit: true };
  if (error.status === 403 || error.code === "forbidden") {
    return {
      text:
        "Pairing a server isn't available to your account right now. Adding servers may be switched off, " +
        "or your account may be at its server limit. Try again later.",
      limit: true,
    };
  }
  return undefined;
}
