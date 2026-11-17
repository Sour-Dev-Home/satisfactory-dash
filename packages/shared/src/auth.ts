import { z } from "zod";

/**
 * ADR-0011, ADR-0025: Google sign-in; the session is a database session referenced by an
 * httpOnly cookie. No token ever appears in a request or response body; the cookie is the
 * only credential.
 */

/** ADR-0025 (additive and optional per the deploy-skew rule: an older backend omits it). */
const SignInMethodsSchema = z
  .array(z.string())
  .optional()
  .describe(
    "How anyone can sign in to this backend right now, e.g. [\"google\"] or [\"google\", \"google_signup\"]: " +
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
        name: z.string().describe("The account's display name"),
        // ADR-0025 (additive and optional per the deploy-skew rule: an older backend sends neither).
        email: z
          .string()
          .optional()
          .describe("The account's email, when it has one (Google sign-in). For the account menu only."),
        authMethods: z
          .array(z.string())
          .optional()
          .describe(
            "How this account can sign in, e.g. \"google\". A plain string array, " +
              "not an enum, so a method added later doesn't fail an already-deployed frontend's parse.",
          ),
      }),
    }),
    z.object({ authenticated: z.literal(false), signInMethods: SignInMethodsSchema }),
  ])
  .describe("Returned by logout and the session check.");

export type SessionResponse = z.infer<typeof SessionResponseSchema>;
