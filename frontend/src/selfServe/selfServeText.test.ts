import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors";
import { addServerErrorText, isPending, isSelfServeOwner, nameProblem, ownerActionErrorText, retryText } from "./selfServeText";

const apiError = (status: number, code: string, message = "m", retryAfter?: number) =>
  new ApiError(status, { code, message, requestId: "r" }, retryAfter);

describe("isSelfServeOwner", () => {
  it("is true only for the owner of a self_serve server", () => {
    expect(isSelfServeOwner({ role: "owner", createdVia: "self_serve" })).toBe(true);
    expect(isSelfServeOwner({ role: "admin", createdVia: "self_serve" })).toBe(false);
    expect(isSelfServeOwner({ role: "viewer", createdVia: "self_serve" })).toBe(false);
    expect(isSelfServeOwner({ role: "owner", createdVia: "operator" })).toBe(false);
    expect(isSelfServeOwner({ role: "owner" })).toBe(false); // an older backend omits createdVia
    expect(isSelfServeOwner({})).toBe(false);
  });
});

describe("isPending", () => {
  it("needs the list to say enrolled is false, and the agent status not to say otherwise", () => {
    expect(isPending({ enrolled: false }, undefined)).toBe(true);
    expect(isPending({ enrolled: false }, false)).toBe(true);
    expect(isPending({ enrolled: false }, true)).toBe(false);
    expect(isPending({ enrolled: true }, undefined)).toBe(false);
    expect(isPending({}, undefined)).toBe(false);
  });
});

describe("nameProblem", () => {
  it("uses the shared schema's rules", () => {
    expect(nameProblem("")).toBe("Enter a name for your server.");
    expect(nameProblem("   ")).toBe("Enter a name for your server.");
    expect(nameProblem("My world")).toBeUndefined();
    expect(nameProblem("x".repeat(65))).toBe("Enter a name of up to 64 characters");
    expect(nameProblem("bad\u0000name")).toMatch(/printable text/);
  });
});

describe("retryText", () => {
  it("rounds the wait to words", () => {
    expect(retryText(undefined)).toBe("later");
    expect(retryText(0)).toBe("later");
    expect(retryText(30)).toBe("in a minute");
    expect(retryText(600)).toBe("in about 10 minutes");
    expect(retryText(18_000)).toBe("in about 5 hours");
    expect(retryText(18_001)).toBe("in about 6 hours");
  });
});

describe("addServerErrorText", () => {
  it("passes the cap messages through, which are specific (C1 to C3)", () => {
    expect(addServerErrorText(apiError(409, "server_limit_reached", "You already have 2 server(s)."))).toBe(
      "You already have 2 server(s).",
    );
  });
  it("says when to retry a 429 (C5), or just later without a Retry-After", () => {
    expect(addServerErrorText(apiError(429, "rate_limited", "x", 7200))).toBe(
      "You can't add another server right now. Try again in about 2 hours.",
    );
    expect(addServerErrorText(apiError(429, "rate_limited"))).toBe("You can't add another server right now. Try again later.");
  });
  it("words 403 as self-serve being off, and leaves anything else to ErrorNotice", () => {
    expect(addServerErrorText(apiError(403, "forbidden"))).toBe("Adding your own server isn't available right now.");
    expect(addServerErrorText(apiError(500, "internal"))).toBeUndefined();
    expect(addServerErrorText(new Error("network"))).toBeUndefined();
    expect(addServerErrorText(null)).toBeUndefined();
  });
});

describe("ownerActionErrorText", () => {
  it("words the owner-only refusal and an already removed server", () => {
    expect(ownerActionErrorText(apiError(403, "forbidden"))).toMatch(/Only the owner/);
    expect(ownerActionErrorText(apiError(404, "server_not_found"))).toMatch(/already been removed/);
    expect(ownerActionErrorText(apiError(500, "x"))).toBeUndefined();
  });
});
