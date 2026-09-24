import { describe, it, expect } from "vitest";
import { SessionResponseSchema, endpoints } from "../src/index";

describe("SessionResponse.signInMethods (additive)", () => {
  it("parses a signed-out response with and without it (an older backend omits it)", () => {
    expect(SessionResponseSchema.parse({ authenticated: false, signInMethods: ["password", "google"] })).toEqual({
      authenticated: false,
      signInMethods: ["password", "google"],
    });
    expect(SessionResponseSchema.parse({ authenticated: false })).toEqual({ authenticated: false });
  });

  it("is optional on a signed-in response and accepts methods added later (plain strings)", () => {
    const user = { name: "operator" };
    expect(SessionResponseSchema.safeParse({ authenticated: true, user }).success).toBe(true);
    expect(SessionResponseSchema.safeParse({ authenticated: true, user, signInMethods: ["passkey"] }).success).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(SessionResponseSchema.safeParse({ authenticated: false, signInMethods: "google" }).success).toBe(false);
  });

  it("names the Google start path for the login button (a redirect, so no response schema)", () => {
    expect(endpoints.auth.googleStart.path()).toBe("/api/auth/google/start");
    expect("response" in endpoints.auth.googleStart).toBe(false);
  });
});
