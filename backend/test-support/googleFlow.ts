import request from "supertest";
import type { Express } from "express";
import { LOGIN_ATTEMPT_COOKIE } from "../src/modules/identity/routes/googleAuth.js";
import type { FakeClaims, FakeOidcIssuer } from "./fakeOidcIssuer.js";

export interface BegunSignIn {
  start: request.Response;
  /** `name=value`, ready for a Cookie header (empty when /start set none). */
  attemptCookie: string;
  authUrl: URL | undefined;
}

/** Step 1: the browser hits /start and is redirected to the provider. */
export async function beginGoogleSignIn(app: Express, returnParam?: string): Promise<BegunSignIn> {
  const query = returnParam === undefined ? "" : `?return=${encodeURIComponent(returnParam)}`;
  const start = await request(app).get(`/api/auth/google/start${query}`);
  const setCookie = [start.headers["set-cookie"] ?? []].flat().find((c: string) => c.startsWith(`${LOGIN_ATTEMPT_COOKIE}=`));
  const location = start.headers.location;
  return {
    start,
    attemptCookie: setCookie ? setCookie.split(";")[0]! : "",
    authUrl: start.status === 302 && location ? new URL(location) : undefined,
  };
}

export interface CallbackOptions {
  claims: FakeClaims;
  /** Override what the provider signs into the ID token / echoes back, to simulate attacks. */
  nonce?: string;
  state?: string;
  extraCookies?: string[];
  /** Skip sending the attempt cookie (e.g. a callback from another browser). */
  omitAttemptCookie?: boolean;
}

/** Step 2: the provider redirects back with a code; the browser hits /callback. */
export async function completeGoogleSignIn(
  app: Express,
  issuer: FakeOidcIssuer,
  begun: BegunSignIn,
  options: CallbackOptions,
): Promise<request.Response> {
  const authUrl = begun.authUrl!;
  const code = issuer.issueCode({
    claims: options.claims,
    nonce: options.nonce ?? authUrl.searchParams.get("nonce")!,
    codeChallenge: authUrl.searchParams.get("code_challenge")!,
  });
  const state = options.state ?? authUrl.searchParams.get("state")!;
  const cookies = [...(options.omitAttemptCookie ? [] : [begun.attemptCookie]), ...(options.extraCookies ?? [])];
  return request(app)
    .get(`/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
    .set("Cookie", cookies.join("; "));
}
