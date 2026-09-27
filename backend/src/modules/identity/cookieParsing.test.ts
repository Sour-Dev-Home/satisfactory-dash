import express from "express";
import type { Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, clearSessionCookie, readSessionCookie, setSessionCookie } from "./session.js";

// cookie 0.7 -> 2.x migration (#295): `parse` became `parseCookie`. These tests pin what the session and login-attempt
// cookies depend on: how the REQUEST Cookie header is read, and that the SET-COOKIE header (built by Express with its
// own nested cookie 0.7) is unchanged.

const reqWith = (cookie: string | undefined): Request => ({ headers: cookie === undefined ? {} : { cookie } }) as Request;

describe("reading the session cookie from the request", () => {
  it("finds it among other cookies, in any position", () => {
    expect(readSessionCookie(reqWith(`${SESSION_COOKIE}=abc`))).toBe("abc");
    expect(readSessionCookie(reqWith(`a=1; ${SESSION_COOKIE}=abc; b=2`))).toBe("abc");
    expect(readSessionCookie(reqWith(`a=1;${SESSION_COOKIE}=abc`))).toBe("abc");
    expect(readSessionCookie(reqWith(`  ${SESSION_COOKIE} = abc  ; b=2`))).toBe("abc");
  });

  it("is undefined with no Cookie header, an empty one, another cookie only, or an empty value", () => {
    expect(readSessionCookie(reqWith(undefined))).toBeUndefined();
    expect(readSessionCookie(reqWith(""))).toBeUndefined();
    expect(readSessionCookie(reqWith("a=1"))).toBeUndefined();
    expect(readSessionCookie(reqWith(`${SESSION_COOKIE}=`))).toBeUndefined();
    expect(readSessionCookie(reqWith("garbage"))).toBeUndefined();
  });

  it("when the cookie appears twice the FIRST one wins (unchanged; a later injected duplicate cannot override it)", () => {
    expect(readSessionCookie(reqWith(`${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second`))).toBe("first");
  });

  it("percent-decodes the value, and a malformed escape is kept as sent (no throw)", () => {
    expect(readSessionCookie(reqWith(`${SESSION_COOKIE}=a%2Fb%3Dc`))).toBe("a/b=c");
    expect(readSessionCookie(reqWith(`${SESSION_COOKIE}=%E0%A4%A`))).toBe("%E0%A4%A");
  });

  it("CHANGED in cookie 2: a double-quoted value keeps its quotes, so it is a different (unknown) value and signs no one in", () => {
    // cookie 0.7 stripped the quotes. Ours are never quoted (Express writes them plain), so a quoted one is foreign:
    // it fails closed (an unknown session id), never opens a session.
    expect(readSessionCookie(reqWith(`${SESSION_COOKIE}="abc"`))).toBe('"abc"');
  });

  it("a __proto__ or constructor cookie cannot shadow the session cookie or be read as one", () => {
    expect(readSessionCookie(reqWith("__proto__=x"))).toBeUndefined();
    expect(readSessionCookie(reqWith("constructor=x; toString=y"))).toBeUndefined();
    expect(readSessionCookie(reqWith(`__proto__=x; ${SESSION_COOKIE}=abc`))).toBe("abc");
  });

  it("never throws on hostile input", () => {
    for (const header of [";;;", "=", "==", "a", ";a=", "=;", `${SESSION_COOKIE}`, "\u0000=\u0000", "a=1;".repeat(5000)]) {
      expect(() => readSessionCookie(reqWith(header))).not.toThrow();
    }
  });
});

describe("the Set-Cookie header (Express, cookie 0.7 nested under it) is unchanged", () => {
  const app = express();
  app.get("/set", (_req, res) => {
    setSessionCookie(res, "tok_en-1", 3600);
    res.end();
  });
  app.get("/clear", (_req, res) => {
    clearSessionCookie(res);
    res.end();
  });

  it("sets the session cookie with HttpOnly, Secure, SameSite=Lax, Path=/api and the exact lifetime", async () => {
    const res = await request(app).get("/set");
    const header = [res.headers["set-cookie"]].flat()[0] as string;
    expect(header).toMatch(new RegExp(`^${SESSION_COOKIE}=tok_en-1; Max-Age=3600; Path=/api; Expires=[A-Z][a-z]{2}, \\d{2} [A-Z][a-z]{2} \\d{4} \\d{2}:\\d{2}:\\d{2} GMT; HttpOnly; Secure; SameSite=Lax$`));
  });

  it("clears it with an expiry in 1970 and the same scope attributes", async () => {
    const res = await request(app).get("/clear");
    const header = [res.headers["set-cookie"]].flat()[0] as string;
    expect(header).toBe(`${SESSION_COOKIE}=; Path=/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`);
  });

  it("the value a browser sends back is read back identically", async () => {
    const set = await request(app).get("/set");
    const pair = ([set.headers["set-cookie"]].flat()[0] as string).split(";")[0]!;
    expect(readSessionCookie(reqWith(pair))).toBe("tok_en-1");
  });
});
