import { endpoints } from "@satisfactory-dash/shared";
import { apiHref } from "../api/client";

/**
 * ADR-0025 decision 3: the backend's Google callback sends a failed sign-in back to
 * /app/login?error=<code>. Only these fixed texts are shown: the query is never rendered, so a
 * crafted link can't put words on the sign-in screen.
 */
const ERROR_TEXT: Record<string, string> = {
  denied: "Google sign-in was cancelled.",
  expired: "That sign-in took too long. Try again.",
  failed: "Google sign-in didn't work. Try again.",
  not_invited: "This Google account hasn't been invited yet. Ask the server's owner for an invitation.",
  unavailable: "Google sign-in isn't available right now. Try again later.",
  terms_required: "There is no account for this Google sign-in yet. Accept the Terms below to create one.",
  signup_busy: "New accounts are paused for a while. Try again later.",
};
/**
 * The terms text a new account accepts (ADR-0046 question 6): the "Last updated" date of
 * public/terms.html. The backend holds the same constant (identity/signupConfig.ts) and ignores any
 * other value, so bump both together.
 */
export const TERMS_VERSION = "2026-10-21";

const UNKNOWN_ERROR = "Sign-in didn't work. Try again.";

/** The message for a sign-in error in the URL, or null when there's none. */
export function signInErrorText(search: string): string | null {
  const code = new URLSearchParams(search).get("error");
  if (code === null) return null;
  return Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code] : UNKNOWN_ERROR;
}

/** Whether this backend offers Google sign-in (an older backend sends no list: no). */
export const offersGoogle = (signInMethods: readonly string[] | undefined): boolean =>
  signInMethods?.includes("google") ?? false;

/** Whether this backend lets a new Google account be created ("google_signup" in the list, ADR-0046). */
export const offersSignup = (signInMethods: readonly string[] | undefined): boolean =>
  signInMethods?.includes("google_signup") ?? false;

/** A relative /app path (not the login page, not protocol-relative, no backslash or control characters). */
export const isAppReturnPath = (path: string): boolean =>
  /^\/app(\/|\?|#|$)/.test(path) && !/^\/app\/login(\/|\?|#|$)/.test(path) && !/[\\\u0000-\u001f\u007f]/.test(path) && path.length <= 2048;

/** The original page to return to, carried back on the terms step's URL (`?return=`), or null. */
export const termsReturnPath = (search: string): string | null => {
  const value = new URLSearchParams(search).get("return");
  return value !== null && isAppReturnPath(value) ? value : null;
};

/** Whether the URL says Google found no account and the terms must be accepted to create one. */
export const needsTermsStep = (search: string): boolean => new URLSearchParams(search).get("error") === "terms_required";

/**
 * The "Sign in with Google" link: a full-page navigation to the backend (it answers with a
 * redirect to Google, never JSON), returning to the /app page the visitor was on. Only an /app
 * path is sent back; /app/login, or anything else, returns to the Overview. `acceptTerms` adds the
 * terms version the person just ticked (the backend honours it only for a new account).
 */
export function googleStartHref(pathname: string, acceptTerms = false, returnTo?: string | null): string {
  const inApp = pathname === "/app" || pathname.startsWith("/app/");
  // After the terms step the page is /app/login, so the visitor's original page comes back from the backend's
  // `return` parameter. It is only handed back to /start (which validates it again); never navigated to here.
  const back = returnTo && isAppReturnPath(returnTo) ? returnTo : inApp && !pathname.startsWith("/app/login") ? pathname : "/app";
  const params = new URLSearchParams({ return: back });
  if (acceptTerms) params.set("terms", TERMS_VERSION);
  return `${apiHref(endpoints.auth.googleStart.path())}?${params}`;
}
