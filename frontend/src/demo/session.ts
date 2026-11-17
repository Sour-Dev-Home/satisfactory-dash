import type { SessionResponse } from "@satisfactory-dash/shared";

/**
 * The demo tab's one session (ADR-0026). Its own tiny module, with no imports but a type, because DemoEntry (statically
 * imported by AuthGate) reads it: importing handlers.ts there could pull the demo world into a build that tree-shakes
 * it otherwise. The handlers answer `GET /api/auth/session` and log out from the same object.
 */
export const SIGNED_IN: SessionResponse = { authenticated: true, user: { name: "Demo visitor" } };
export const SIGNED_OUT: SessionResponse = { authenticated: false };

export const demoSession = { signedIn: false };

/**
 * "Enter demo": signs this tab's demo in, without credentials (there's nothing to protect) and without an API call:
 * since gate B (2026-11-17) there is no password sign-in to borrow, and Google can't run in the demo. Returns the
 * session `GET /api/auth/session` now answers, for DemoEntry to put in the query cache.
 */
export function enterDemo(): SessionResponse {
  demoSession.signedIn = true;
  return SIGNED_IN;
}
