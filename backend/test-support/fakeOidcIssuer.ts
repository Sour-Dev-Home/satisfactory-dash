import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

/** What the fake identity provider puts in an ID token (raw, so a test can send a string "true"). */
export interface FakeClaims {
  sub: string;
  email?: string;
  email_verified?: unknown;
}

interface PendingGrant {
  claims: FakeClaims;
  nonce: string;
  codeChallenge: string;
}

export interface FakeOidcIssuer {
  /** The issuer URL (a local http origin); pass it to createGoogleOidc via `allowInsecureRequests`. */
  issuer: URL;
  /** Registers a one-time authorization code that exchanges for an ID token with these claims.
   *  `nonce` and `codeChallenge` are normally copied from the authorization URL /start redirected to. */
  issueCode(input: { claims: FakeClaims; nonce: string; codeChallenge: string }): string;
  /** How many times each path was hit (to assert nothing talked to the issuer when it shouldn't). */
  hits(): Record<string, number>;
  close(): Promise<void>;
}

/**
 * A minimal OpenID provider for integration tests: a discovery document, a JWKS and a token endpoint
 * that verifies PKCE and signs ID tokens with RS256. Plain http on 127.0.0.1 (the client is told to
 * allow insecure requests for it in tests only).
 */
export async function startFakeOidcIssuer(clientId: string): Promise<FakeOidcIssuer> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "fake-key", alg: "RS256", use: "sig" };
  const grants = new Map<string, PendingGrant>();
  const hitCounts: Record<string, number> = {};
  let origin = "";

  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://placeholder.invalid").pathname;
    hitCounts[path] = (hitCounts[path] ?? 0) + 1;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (path === "/.well-known/openid-configuration") {
      json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        jwks_uri: `${origin}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    if (path === "/jwks") {
      json(200, { keys: [jwk] });
      return;
    }
    if (path === "/token" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void (async () => {
          const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
          const grant = grants.get(form.get("code") ?? "");
          grants.delete(form.get("code") ?? ""); // one time
          const verifier = form.get("code_verifier") ?? "";
          const challenge = createHash("sha256").update(verifier).digest("base64url");
          if (grant === undefined || challenge !== grant.codeChallenge) {
            json(400, { error: "invalid_grant" });
            return;
          }
          const idToken = await new SignJWT({ ...grant.claims, nonce: grant.nonce })
            .setProtectedHeader({ alg: "RS256", kid: "fake-key" })
            .setIssuer(origin)
            .setAudience(clientId)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(privateKey);
          json(200, { access_token: randomBytes(8).toString("hex"), token_type: "Bearer", expires_in: 300, id_token: idToken });
        })();
      });
      return;
    }
    json(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake issuer failed to bind");
  }
  origin = `http://127.0.0.1:${address.port}`;

  return {
    issuer: new URL(origin),
    issueCode: (input) => {
      const code = randomBytes(12).toString("hex");
      grants.set(code, input);
      return code;
    },
    hits: () => ({ ...hitCounts }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
