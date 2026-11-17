import { describe, it, expect } from "vitest";
import { SessionResponseSchema, endpoints } from "../src/index";

describe("SessionResponse.signInMethods (additive)", () => {
  it("parses a signed-out response with and without it (an older backend omits it)", () => {
    expect(SessionResponseSchema.parse({ authenticated: false, signInMethods: ["google", "google_signup"] })).toEqual({
      authenticated: false,
      signInMethods: ["google", "google_signup"],
    });
    expect(SessionResponseSchema.parse({ authenticated: false })).toEqual({ authenticated: false });
  });

  it("is optional on a signed-in response and accepts methods added later (plain strings)", () => {
    const user = { name: "operator" };
    expect(SessionResponseSchema.safeParse({ authenticated: true, user }).success).toBe(true);
    expect(SessionResponseSchema.safeParse({ authenticated: true, user, signInMethods: ["passkey"] }).success).toBe(true);
  });

  it("parses every shape the production backend sends, and keeps unknown method strings intact", () => {
    const bodies = [
      { authenticated: false, signInMethods: ["google"] },
      { authenticated: false, signInMethods: [] },
      { authenticated: true, user: { name: "a", authMethods: [] } },
      { authenticated: true, user: { name: "a", authMethods: ["google"], email: "a@example.test" } },
      { authenticated: true, user: { name: "a", authMethods: ["passkey"] }, signInMethods: ["passkey"] },
    ];
    for (const body of bodies) expect(SessionResponseSchema.parse(body)).toEqual(body);
  });

  it("exports no password-login schema or endpoint", async () => {
    const shared = (await import("../src/index")) as Record<string, unknown>;
    expect(shared.LoginRequestSchema).toBeUndefined();
    expect("login" in endpoints.auth).toBe(false);
  });

  it("rejects a non-array", () => {
    expect(SessionResponseSchema.safeParse({ authenticated: false, signInMethods: "google" }).success).toBe(false);
  });

  it("names the Google start path for the login button (a redirect, so no response schema)", () => {
    expect(endpoints.auth.googleStart.path()).toBe("/api/auth/google/start");
    expect("response" in endpoints.auth.googleStart).toBe(false);
  });
});
