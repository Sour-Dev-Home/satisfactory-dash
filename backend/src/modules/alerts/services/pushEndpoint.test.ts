import { describe, expect, it } from "vitest";
import { parsePushEndpoint } from "./pushEndpoint.js";

const HOSTS = ["push.example.test", "*.notify.example.org"];
const ok = (raw: string) => parsePushEndpoint(raw, HOSTS);
const reason = (raw: unknown) => {
  const result = parsePushEndpoint(raw, HOSTS);
  return result.ok ? "ok" : result.reason;
};

describe("parsePushEndpoint (ADR-0044 decision 3: the SSRF rule)", () => {
  it("accepts an https URL on an allowlisted host, with a path and a query (some push services use one)", () => {
    const result = ok("https://push.example.test/send/abc123");
    expect(result).toMatchObject({ ok: true, host: "push.example.test", url: "https://push.example.test/send/abc123" });
    expect(ok("https://db5.notify.example.org/?token=abc%3D")).toMatchObject({ ok: true, host: "db5.notify.example.org" });
  });

  it("the hash is stable for the same endpoint and differs for another", () => {
    const a = ok("https://push.example.test/send/a");
    const b = ok("https://push.example.test/send/b");
    if (!a.ok || !b.ok) throw new Error("expected both to parse");
    expect(a.hash).toHaveLength(32);
    expect(ok("https://push.example.test/send/a")).toMatchObject({ hash: a.hash });
    expect(a.hash.equals(b.hash)).toBe(false);
  });

  it.each([
    ["http://push.example.test/send/a", "not_https"],
    ["ftp://push.example.test/send/a", "not_https"],
    ["https://evil.example/send/a", "host_not_allowed"],
    ["https://push.example.test.evil.example/send/a", "host_not_allowed"],
    ["https://evilpush.example.test/send/a", "host_not_allowed"],
    ["https://notify.example.org/x", "host_not_allowed"],
    ["https://127.0.0.1/x", "host_not_allowed"],
    ["https://[::1]/x", "host_not_allowed"],
    ["https://localhost/x", "host_not_allowed"],
    ["https://user:pw@push.example.test/x", "credentials_in_url"],
    ["https://push.example.test@evil.example/x", "credentials_in_url"],
    ["https://push.example.test:8443/x", "port_not_allowed"],
    ["https://push.example.test/x#frag", "fragment_not_allowed"],
    ["https://push.example.test/x#", "fragment_not_allowed"],
    ["https://push.example.test/ x", "not_a_url"],
    ["https://push.example.test/\tx", "not_a_url"],
    ["https://push.example.test\\@evil.example/x", "not_a_url"],
    ["not a url", "not_a_url"],
    ["/relative/path", "not_a_url"],
    ["", "not_a_url"],
    [`https://push.example.test/${"a".repeat(2048)}`, "too_long"],
  ])("refuses %j as %s", (raw, expected) => {
    expect(reason(raw)).toBe(expected);
  });

  it("refuses anything that is not a string", () => {
    for (const value of [undefined, null, 5, {}, ["https://push.example.test/x"]]) expect(reason(value)).toBe("not_a_url");
  });

  it("a refusal carries a stable code only, never the input", () => {
    const result = ok("https://evil.example/secret-token-123");
    expect(JSON.stringify(result)).not.toContain("secret-token-123");
    expect(JSON.stringify(result)).not.toContain("evil.example");
  });
});
