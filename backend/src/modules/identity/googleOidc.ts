import * as oidc from "openid-client";
import { ServiceUnavailableError } from "../../platform/errorResponse.js";
import type { GoogleConfig } from "./googleConfig.js";

/** ADR-0025 decision 3: Google is the identity provider, spoken to through openid-client v6. */
const GOOGLE_ISSUER = "https://accounts.google.com";
/** Seconds, for discovery and every later request to Google (openid-client's unit). */
const REQUEST_TIMEOUT_SECONDS = 10;

/** Test-only escape hatches (never read from the environment): a local fake issuer over plain http. */
export interface GoogleOidcOptions {
  issuer?: URL;
  allowInsecureRequests?: boolean;
}

/** What a completed authorization code exchange yields: the verified ID token's claims, nothing else. */
export interface GoogleClaims {
  sub: string;
  email: string | undefined;
  emailVerified: unknown;
}

export interface GoogleOidc {
  /** The URL to send the browser to. Throws ServiceUnavailableError when Google can't be reached. */
  authorizationUrl(input: { state: string; nonce: string; codeVerifier: string }): Promise<URL>;
  /** Exchanges the callback's code and verifies the ID token (state, nonce, PKCE, signature, issuer,
   *  audience, expiry). `callbackUrl` must be the configured redirect URI plus the response's query.
   *  Throws whatever openid-client throws on a bad response; a discovery outage is a ServiceUnavailableError. */
  exchange(input: { callbackUrl: URL; state: string; nonce: string; codeVerifier: string }): Promise<GoogleClaims>;
}

/**
 * Discovery is lazy and cached: nothing talks to Google at startup, so a Google outage can never
 * keep the backend from starting or affect any other route. A failed discovery is NOT cached (the
 * next request retries) and surfaces as a 503 to that one request. Concurrent first requests share
 * one in-flight discovery.
 */
export function createGoogleOidc(config: GoogleConfig, options: GoogleOidcOptions = {}): GoogleOidc {
  let cached: Promise<oidc.Configuration> | undefined;

  const discover = (): Promise<oidc.Configuration> => {
    cached ??= oidc
      .discovery(
        options.issuer ?? new URL(GOOGLE_ISSUER),
        config.clientId,
        config.clientSecret,
        undefined,
        {
          timeout: REQUEST_TIMEOUT_SECONDS,
          ...(options.allowInsecureRequests ? { execute: [oidc.allowInsecureRequests] } : {}),
        },
      )
      .catch((err: unknown) => {
        cached = undefined;
        throw Object.assign(new ServiceUnavailableError(), { cause: err });
      });
    return cached;
  };

  return {
    async authorizationUrl({ state, nonce, codeVerifier }) {
      const configuration = await discover();
      return oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: config.redirectUri,
        scope: "openid email",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
      });
    },

    async exchange({ callbackUrl, state, nonce, codeVerifier }) {
      const configuration = await discover();
      const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (claims === undefined) {
        throw new Error("The token response carried no ID token.");
      }
      return { sub: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined, emailVerified: claims.email_verified };
    },
  };
}
