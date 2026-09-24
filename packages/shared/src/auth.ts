import { z } from "zod";

/**
 * ADR-0011: one operator account, session in a signed httpOnly cookie. No token ever
 * appears in a request or response body; the cookie is the only credential.
 */

// Length caps bound the work a single login attempt can cause (the password is hashed
// with scrypt) as well as the request size. They're a sanity limit, not a policy.
export const LoginRequestSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
});

/** ADR-0025 (additive and optional per the deploy-skew rule: an older backend omits it). */
const SignInMethodsSchema = z
  .array(z.string())
  .optional()
  .describe(
    "How anyone can sign in to this backend right now, e.g. [\"password\"] or [\"password\", \"google\"]: " +
      "what the login screen may offer. Always sent by a current backend on a signed-out response, " +
      "optional on a signed-in one. Distinct from authMethods (what this account has linked). A plain " +
      "string array, not an enum, so a method added later doesn't fail an already-deployed " +
      "frontend's parse.",
  );

export const SessionResponseSchema = z
  .discriminatedUnion("authenticated", [
    z.object({
      authenticated: z.literal(true),
      signInMethods: SignInMethodsSchema,
      user: z.object({
        name: z.string().describe("The account's display name (the operator's username for password login)"),
        // ADR-0025 (additive and optional per the deploy-skew rule: an older backend sends neither).
        email: z
          .string()
          .optional()
          .describe("The account's email, when it has one (Google sign-in). For the account menu only."),
        authMethods: z
          .array(z.string())
          .optional()
          .describe(
            "How this account can sign in: \"password\" and/or \"google\". A plain string array, " +
              "not an enum, so a method added later doesn't fail an already-deployed frontend's parse.",
          ),
      }),
    }),
    z.object({ authenticated: z.literal(false), signInMethods: SignInMethodsSchema }),
  ])
  .describe(
    "Returned by login, logout and the session check. A failed login is a 401 unauthorized " +
      "error, not authenticated:false.",
  );

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
