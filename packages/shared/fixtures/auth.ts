import type { SessionResponse } from "../src/index";

/** GET /api/auth/session with a valid cookie. */
export const sessionAuthenticated = { authenticated: true, user: { name: "operator" } } satisfies SessionResponse;

/** ADR-0025: a Google-signed-in account. `email` and `authMethods` are optional (an older
 *  backend sends neither), and only present for accounts that have them. */
export const sessionAuthenticatedWithAccount = {
  authenticated: true,
  user: { name: "Ann", email: "ann@example.com", authMethods: ["google"] },
} satisfies SessionResponse;

/** GET /api/auth/session with no valid cookie, or POST /api/auth/logout or /logout-all. */
export const sessionAnonymous = { authenticated: false } satisfies SessionResponse;
