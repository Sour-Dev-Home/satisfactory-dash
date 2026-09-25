import { describe, expect, it } from "vitest";
import { googleStartHref, offersGoogle, signInErrorText } from "./googleSignIn";

describe("signInErrorText", () => {
  it.each([
    ["denied", "Google sign-in was cancelled."],
    ["expired", "That sign-in took too long. Try again."],
    ["failed", "Google sign-in didn't work. Try again."],
    ["not_invited", "This Google account hasn't been invited yet. Ask the server's owner for an invitation."],
    ["unavailable", "Google sign-in isn't available right now. Try again later."],
  ])("maps %s to its fixed text", (code, text) => {
    expect(signInErrorText(`?error=${code}`)).toBe(text);
  });

  it("never echoes an unknown code or other query text", () => {
    const text = signInErrorText("?error=%3Cb%3EYou%20were%20hacked%3C%2Fb%3E");
    expect(text).toBe("Sign-in didn't work. Try again.");
    expect(signInErrorText("?error=toString")).toBe("Sign-in didn't work. Try again.");
  });

  it("is null without an error", () => {
    expect(signInErrorText("")).toBeNull();
    expect(signInErrorText("?scenario=login")).toBeNull();
  });
});

describe("offersGoogle", () => {
  it("only when the backend lists google", () => {
    expect(offersGoogle(["password", "google"])).toBe(true);
    expect(offersGoogle(["password"])).toBe(false);
    expect(offersGoogle(undefined)).toBe(false); // an older backend sends no list
  });
});

describe("googleStartHref", () => {
  const returnOf = (href: string) => new URL(href, "http://x").searchParams.get("return");

  it("goes to the backend's Google start and returns to the /app page you were on", () => {
    const href = googleStartHref("/app/power");
    expect(href.startsWith("/api/auth/google/start?")).toBe(true);
    expect(returnOf(href)).toBe("/app/power");
  });

  it("returns to the Overview from the login page itself or anywhere outside /app", () => {
    expect(returnOf(googleStartHref("/app/login"))).toBe("/app");
    expect(returnOf(googleStartHref("/"))).toBe("/app");
    expect(returnOf(googleStartHref("/application"))).toBe("/app");
    expect(returnOf(googleStartHref("/app"))).toBe("/app");
  });
});
