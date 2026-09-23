import type { LoginRequest, SessionResponse } from "../src/index";

/** A login request body. Example values only; never a real credential. */
export const loginRequestValid = { username: "operator", password: "example-password" } satisfies LoginRequest;

/** GET /api/auth/session or a successful POST /api/auth/login. */
export const sessionAuthenticated = { authenticated: true, user: { name: "operator" } } satisfies SessionResponse;

/** GET /api/auth/session with no valid cookie, or POST /api/auth/logout. */
export const sessionAnonymous = { authenticated: false } satisfies SessionResponse;
