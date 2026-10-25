import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors";
import { askedText, codeProblem, formatCode, pairErrorText } from "./pairText";

const apiError = (status: number, code: string, retry?: number) =>
  new ApiError(status, { code, message: "m", requestId: "00000000-0000-4000-8000-000000000001" }, retry);

describe("formatCode", () => {
  it("upper-cases, drops separators and groups in fours", () => {
    expect(formatCode("ab3d")).toBe("AB3D");
    expect(formatCode("ab3d7")).toBe("AB3D-7");
    expect(formatCode(" ab3d-7xq2_k5mn ")).toBe("AB3D-7XQ2-K5MN");
    expect(formatCode("ab3d7xq2k5mnzzzz")).toBe("AB3D-7XQ2-K5MN");
    expect(formatCode("")).toBe("");
  });
});

describe("codeProblem", () => {
  it("accepts a full code and names the problem otherwise", () => {
    expect(codeProblem("AB3D-7XQ2-K5MN")).toBeUndefined();
    expect(codeProblem("")).toMatch(/Enter the code/);
    expect(codeProblem("AB3D-7XQ2")).toMatch(/12 letters and digits/);
    expect(codeProblem("AB3D-7XQ2-K5M1")).toMatch(/12 letters and digits/);
  });
});

describe("askedText", () => {
  const at = "2026-10-25T12:00:00.000Z";
  it("reads an age as text", () => {
    expect(askedText(at, Date.parse(at) + 20_000)).toBe("asked just now");
    expect(askedText(at, Date.parse(at) + 60_000)).toBe("asked 1 minute ago");
    expect(askedText(at, Date.parse(at) + 7 * 60_000)).toBe("asked 7 minutes ago");
    expect(askedText(at, Date.parse(at) - 60_000)).toBe("asked just now");
  });
});

describe("pairErrorText", () => {
  it("gives a missing code one message, whatever the reason", () => {
    expect(pairErrorText(apiError(404, "not_found"))?.text).toMatch(/isn't valid/);
  });
  it("gives a 429 its wait", () => {
    expect(pairErrorText(apiError(429, "rate_limited", 60))?.text).toBe("Too many tries. Wait a minute, then try again.");
    expect(pairErrorText(apiError(429, "rate_limited"))?.text).toBe("Too many tries. Wait a little while, then try again.");
  });
  it("explains a 403 and leaves other errors to ErrorNotice", () => {
    expect(pairErrorText(apiError(403, "forbidden"))?.limit).toBe(true);
    expect(pairErrorText(apiError(500, "internal_error"))).toBeUndefined();
    expect(pairErrorText(new Error("x"))).toBeUndefined();
  });
});
