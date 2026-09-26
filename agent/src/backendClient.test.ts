import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { agentEnrollResponse, agentSnapshotRequestFull, agentSnapshotResponse } from "@satisfactory-dash/shared/fixtures";
import { BackendClient, BackendError, GZIP_OVER_BYTES, parseBackendUrl } from "./backendClient.js";
import type { FetchLike } from "./backendClient.js";

const SECRET = "SECRET-credential-VALUE-1234567890abcdefghijklmnopqrstuv";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const errorBody = (code: string, message = "not shown") => ({ error: { code, message, requestId: "r1" } });

function client(fetchImpl: FetchLike, extra: { agentSecret?: string; timeoutMs?: number } = {}) {
  return new BackendClient({ baseUrl: "https://api.example.test", agentSecret: SECRET, fetch: fetchImpl, ...extra });
}
const failure = async (work: Promise<unknown>) => (await work.then(() => undefined, (err: unknown) => err)) as BackendError;

describe("parseBackendUrl", () => {
  it("accepts https origins, and http only for localhost", () => {
    expect(parseBackendUrl("https://api.example.com")).toBe("https://api.example.com");
    expect(parseBackendUrl("https://api.example.com/")).toBe("https://api.example.com");
    expect(parseBackendUrl("  https://api.example.com:8443  ")).toBe("https://api.example.com:8443");
    for (const local of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001"]) expect(parseBackendUrl(local)).toBe(new URL(local).origin);
  });

  it("refuses plain http elsewhere, other schemes, credentials, paths, queries and junk", () => {
    for (const bad of [
      "http://api.example.com",
      "http://192.168.1.5:3001",
      "http://localhost.evil.com",
      "ftp://api.example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@api.example.com",
      "https://api.example.com/some/path",
      "https://api.example.com/?a=1",
      "https://api.example.com/#frag",
      "api.example.com",
      "",
    ]) {
      const error = (() => {
        try {
          parseBackendUrl(bad);
        } catch (err) {
          return err as BackendError;
        }
        return undefined;
      })();
      expect(error, bad).toBeInstanceOf(BackendError);
      expect(error?.kind).toBe("fatal");
    }
  });

  it("the error never echoes the address it was given (it may hold a password)", () => {
    expect(() => parseBackendUrl("https://user:hunter2@api.example.com")).toThrow(expect.objectContaining({ message: expect.not.stringContaining("hunter2") }));
  });

  it("the client refuses a bad address at construction", () => {
    expect(() => new BackendClient({ baseUrl: "http://api.example.com" })).toThrow(BackendError);
  });
});

describe("the request the client makes", () => {
  it("sends the Bearer on authenticated calls only, never on enrol, and never follows a redirect (redirect: manual)", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return url.endsWith("/enroll") ? json(agentEnrollResponse, 201) : json(agentSnapshotResponse);
    };
    const api = client(fetchImpl);
    await api.enroll("AB3D-7XQ2");
    await api.postSnapshot({ ...agentSnapshotRequestFull, status: undefined, power: undefined, factory: undefined, players: undefined });
    const [enroll, snapshot] = seen as [(typeof seen)[number], (typeof seen)[number]];
    expect(enroll.url).toBe("https://api.example.test/agent/v1/enroll");
    expect((enroll.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(enroll.init.body as string)).toEqual({ code: "AB3D-7XQ2", agentVersion: "0.1.0" });
    expect(snapshot.url).toBe("https://api.example.test/agent/v1/snapshots");
    expect((snapshot.init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    for (const call of seen) expect(call.init.redirect).toBe("manual");
    expect(seen.every((call) => call.init.signal instanceof AbortSignal)).toBe(true); // a timeout on every request
  });

  it("a 3xx is a fatal error, fetched ONCE: the credential is not replayed anywhere", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 307, headers: { location: "https://evil.example/collect" } }));
    const error = await failure(client(fetchImpl).postSnapshot(agentSnapshotRequestFull));
    expect(error.kind).toBe("fatal");
    expect(error.status).toBe(307);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain("evil.example");
    expect(error.message).not.toContain(SECRET);
  });

  it("gzips a large body (the backend inflates it) and sends a small one plain", async () => {
    const bodies: { encoding: string | undefined; body: unknown }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      bodies.push({ encoding: (init.headers as Record<string, string>)["content-encoding"], body: init.body });
      return url.endsWith("/result") ? json({ accepted: true }) : json(agentSnapshotResponse);
    };
    const api = client(fetchImpl);
    await api.postSnapshot({ ...agentSnapshotRequestFull, factory: { buildings: Array.from({ length: 200 }, (_, i) => ({ ...agentSnapshotRequestFull.factory.buildings[0]!, id: `b${i}` })) } });
    await api.postResult("c1", { ok: true });
    expect(bodies[0]!.encoding).toBe("gzip");
    const inflated = JSON.parse(gunzipSync(bodies[0]!.body as Buffer).toString("utf8")) as { factory: { buildings: unknown[] } };
    expect(inflated.factory.buildings).toHaveLength(200);
    expect(Buffer.byteLength(JSON.stringify({ ok: true }))).toBeLessThan(GZIP_OVER_BYTES);
    expect(bodies[1]!.encoding).toBeUndefined();
    expect(bodies[1]!.body).toBe('{"ok":true}');
  });

  it("an authenticated call without a credential fails before any request", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const error = await failure(new BackendClient({ baseUrl: "https://api.example.test", fetch: fetchImpl }).postSnapshot(agentSnapshotRequestFull));
    expect(error.kind).toBe("fatal");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the long-poll asks for waitSeconds (clamped to 0-25) and waits that plus a grace period", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return json({ commands: [] });
    };
    const api = client(fetchImpl);
    await api.pollCommands(25);
    await api.pollCommands(99);
    await api.pollCommands(-4);
    expect(urls.map((url) => new URL(url).search)).toEqual(["?waitSeconds=25", "?waitSeconds=25", "?waitSeconds=0"]);
  });

  it("encodes the command id in the result path", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return json({ accepted: true });
    };
    await client(fetchImpl).postResult("a/b c?d", { ok: false, code: "upstream_error" });
    expect(urls[0]).toBe("https://api.example.test/agent/v1/commands/a%2Fb%20c%3Fd/result");
  });
});

describe("classifying what goes wrong", () => {
  it("a 401 on an authenticated call is auth_rejected (the caller stops and says to re-enrol), never transient", async () => {
    const error = await failure(client(async () => json(errorBody("unauthorized"), 401)).postSnapshot(agentSnapshotRequestFull));
    expect(error.kind).toBe("auth_rejected");
    expect(error.status).toBe(401);
  });

  it("network failures, timeouts, 5xx, 429 and 503 are transient; Retry-After is read (seconds, capped at 5 minutes)", async () => {
    const boom = await failure(client(async () => Promise.reject(new TypeError("fetch failed: ECONNREFUSED 10.0.0.1"))).postSnapshot(agentSnapshotRequestFull));
    expect([boom.kind, boom.message]).toEqual(["transient", "The backend could not be reached."]);
    for (const status of [500, 502, 503, 504]) {
      const error = await failure(client(async () => json(errorBody("internal"), status)).postSnapshot(agentSnapshotRequestFull));
      expect([error.kind, error.status], String(status)).toEqual(["transient", status]);
    }
    const limited = await failure(client(async () => json(errorBody("rate_limited"), 429, { "retry-after": "7" })).postSnapshot(agentSnapshotRequestFull));
    expect([limited.kind, limited.retryAfterMs, limited.code]).toEqual(["transient", 7000, "rate_limited"]);
    const huge = await failure(client(async () => json(errorBody("rate_limited"), 429, { "retry-after": "99999" })).postSnapshot(agentSnapshotRequestFull));
    expect(huge.retryAfterMs).toBe(300_000);
    const junk = await failure(client(async () => json(errorBody("rate_limited"), 429, { "retry-after": "soon" })).postSnapshot(agentSnapshotRequestFull));
    expect(junk.retryAfterMs).toBeUndefined();
  });

  it("a request that outlives its timeout is aborted and reported as transient", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
      });
    const error = await failure(client(fetchImpl, { timeoutMs: 30 }).postSnapshot(agentSnapshotRequestFull));
    expect([error.kind, error.message]).toEqual(["transient", "The backend did not answer in time."]);
  });

  it("a caller's own abort (shutdown) is rethrown as is, not classified as a backend failure", async () => {
    const controller = new AbortController();
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const pending = failure(client(fetchImpl).pollCommands(25, controller.signal));
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(BackendError);
  });

  it("other 4xx are fatal for that request, with the backend's code (command_expired and command_not_found included)", async () => {
    for (const [status, code] of [[400, "invalid_request"], [404, "command_not_found"], [409, "command_expired"], [413, "payload_too_large"]] as const) {
      const error = await failure(client(async () => json(errorBody(code), status)).postResult("c1", { ok: true }));
      expect([error.kind, error.status, error.code], code).toEqual(["fatal", status, code]);
    }
  });

  it("errors carry the code only: never the response body, the message text or the secret", async () => {
    const hostile = errorBody("bad_thing", `leaks ${SECRET} and player Alice`);
    for (const status of [400, 401, 429, 500]) {
      const error = await failure(client(async () => json(hostile, status)).postSnapshot(agentSnapshotRequestFull));
      expect(error.message, String(status)).not.toContain(SECRET);
      expect(error.message).not.toContain("Alice");
      expect(JSON.stringify(error.details)).not.toContain("Alice");
    }
  });

  it("an error code that is not a plain identifier is dropped", async () => {
    const error = await failure(client(async () => json(errorBody("<script>alert(1)</script>"), 400)).postSnapshot(agentSnapshotRequestFull));
    expect(error.code).toBeUndefined();
  });

  it("a 200 that is not JSON, or not the expected shape, or too large, is transient (a proxy page in the way), not trusted", async () => {
    const html = await failure(client(async () => new Response("<html>captive portal</html>", { status: 200 })).postSnapshot(agentSnapshotRequestFull));
    expect([html.kind, html.message]).toEqual(["transient", "The backend's answer was not JSON (a proxy or captive page in the way?)."]);
    const wrong = await failure(client(async () => json({ cadence: "fast" })).postSnapshot(agentSnapshotRequestFull));
    expect(wrong.kind).toBe("transient");
    const big = await failure(client(async () => new Response("x".repeat(1_000_001), { status: 200 })).postSnapshot(agentSnapshotRequestFull));
    expect(big.kind).toBe("transient");
    const declared = await failure(client(async () => new Response("{}", { status: 200, headers: { "content-length": "5000000" } })).postSnapshot(agentSnapshotRequestFull));
    expect(declared.kind).toBe("transient");
  });

  it("a good answer is parsed by the contract's schema: the cadence the server sets is what the caller gets", async () => {
    const answer = await client(async () => json({ cadence: { statusSeconds: 10, powerSeconds: 10, factorySeconds: 60 }, commandsPending: true })).postSnapshot(agentSnapshotRequestFull);
    expect(answer).toEqual({ cadence: { statusSeconds: 10, powerSeconds: 10, factorySeconds: 60 }, commandsPending: true });
  });
});
