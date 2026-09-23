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

export const SessionResponseSchema = z
  .discriminatedUnion("authenticated", [
    z.object({
      authenticated: z.literal(true),
      user: z.object({ name: z.string().describe("The operator's username") }),
    }),
    z.object({ authenticated: z.literal(false) }),
  ])
  .describe(
    "Returned by login, logout and the session check. A failed login is a 401 unauthorized " +
      "error, not authenticated:false.",
  );

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
