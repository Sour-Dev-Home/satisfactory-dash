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

  it("never treats a prototype key as a known code", () => {
    expect(signInErrorText("?error=__proto__")).toBe("Sign-in didn't work. Try again.");
    expect(signInErrorText("?error=constructor")).toBe("Sign-in didn't work. Try again.");
    expect(signInErrorText("?error=hasOwnProperty")).toBe("Sign-in didn't work. Try again.");
  });

  it("uses the first value when the error param repeats", () => {
    // URLSearchParams.get returns the first match; a crafted link stacking a known code in
    // front of junk must not smuggle the junk through some other path.
    expect(signInErrorText("?error=denied&error=%3Cb%3Eowned%3C%2Fb%3E")).toBe("Google sign-in was cancelled.");
    expect(signInErrorText("?error=%3Cb%3Eowned%3C%2Fb%3E&error=denied")).toBe("Sign-in didn't work. Try again.");
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

  it("never sends a protocol-relative or off-origin return value", () => {
    // A browser never actually hands window.location.pathname a value starting with "//" for a
    // same-page load (it would be a different origin, a different page), but the pure function
    // should refuse to forward one if it ever received it.
    const inputs = [
      "//evil.com",
      "/\\evil.com",
      "/app//evil.com", // what the browser produces for /app/\evil.com or /app//evil.com
      "/app/http://evil.com", // a real pathname a browser can produce (verified via WHATWG URL)
      "/app/%2F%2Fevil.com",
      "/app/..%2f..",
      "/APP/evil", // case mismatch: falls back, doesn't forward
      "/app\t/evil.com",
      "/app/\u0000evil.com",
    ];
    for (const pathname of inputs) {
      const back = returnOf(googleStartHref(pathname));
      expect(back === "/app" || back?.startsWith("/app/")).toBe(true);
      expect(back?.startsWith("//")).toBe(false);
    }
  });
});
