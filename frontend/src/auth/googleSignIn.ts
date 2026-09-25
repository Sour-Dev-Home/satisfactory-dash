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
};
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

/**
 * The "Sign in with Google" link: a full-page navigation to the backend (it answers with a
 * redirect to Google, never JSON), returning to the /app page the visitor was on. Only an /app
 * path is sent back; /app/login, or anything else, returns to the Overview.
 */
export function googleStartHref(pathname: string): string {
  const inApp = pathname === "/app" || pathname.startsWith("/app/");
  const back = inApp && !pathname.startsWith("/app/login") ? pathname : "/app";
  return `${apiHref(endpoints.auth.googleStart.path())}?${new URLSearchParams({ return: back })}`;
}
