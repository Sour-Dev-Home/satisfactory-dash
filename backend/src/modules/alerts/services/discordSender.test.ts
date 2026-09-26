import { describe, expect, it, vi } from "vitest";
import { sendDiscordMessage } from "./discordSender.js";

const ID = "1234567890123456789";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const URL_OK = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;

const respond = (status: number, init: { headers?: Record<string, string>; body?: string } = {}) =>
  vi.fn(async () => new Response(init.body ?? null, { status, headers: init.headers }));

describe("sendDiscordMessage", () => {
  it("POSTs JSON to the validated URL with redirects set to manual and a deadline, and reports `sent` for a 2xx", async () => {
    const fetchMock = respond(204);
    const outcome = await sendDiscordMessage(URL_OK, { content: "hi" }, { fetch: fetchMock as never });
    expect(outcome).toEqual({ kind: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ content: "hi" });
  });

  it("never fetches a URL that is not an allowlisted webhook (checked again right here)", async () => {
    const fetchMock = respond(204);
    for (const bad of ["https://evil.example/x", `http://discord.com/api/webhooks/${ID}/${TOKEN}`, "", `https://discord.com@evil.example/api/webhooks/${ID}/${TOKEN}`, undefined as never]) {
      expect(await sendDiscordMessage(bad, {}, { fetch: fetchMock as never })).toEqual({ kind: "rejected", code: "invalid_url" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])("a %i redirect is refused and never followed (the Location is not even read)", async (status) => {
    const fetchMock = respond(status, { headers: { location: "http://169.254.169.254/latest/meta-data" } });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: fetchMock as never })).toEqual({ kind: "rejected", code: "redirect_refused" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // one request, no second one to the Location
  });

  it("a 429 retries with the delay Discord asked for: the Retry-After header, or retry_after in the body, in ms", async () => {
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(429, { headers: { "retry-after": "3" } }) as never })).toEqual({ kind: "retry", code: "rate_limited", retryAfterMs: 3000 });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(429, { body: JSON.stringify({ retry_after: 1.5, global: false }) }) as never })).toEqual({ kind: "retry", code: "rate_limited", retryAfterMs: 1500 });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(429) as never })).toEqual({ kind: "retry", code: "rate_limited" });
  });

  it("clamps an absurd retry_after into 1 second to 1 hour, and ignores a junk one", async () => {
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(429, { headers: { "retry-after": "999999" } }) as never })).toMatchObject({ retryAfterMs: 3_600_000 });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(429, { headers: { "retry-after": "0" } }) as never })).toMatchObject({ retryAfterMs: 1000 });
    for (const junk of ["abc", "-5", "1e9", "NaN", "3 seconds"]) {
      expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(429, { headers: { "retry-after": junk } }) as never })).toEqual({ kind: "retry", code: "rate_limited" });
    }
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(429, { body: JSON.stringify({ retry_after: "soon" }) }) as never })).toEqual({ kind: "retry", code: "rate_limited" });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(429, { body: "not json at all" }) as never })).toEqual({ kind: "retry", code: "rate_limited" });
  });

  it.each([500, 502, 503, 504, 599])("a %i is retried later", async (status) => {
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(status) as never })).toEqual({ kind: "retry", code: "server_error" });
  });

  it("a 404 (webhook deleted) and a 401 (token no longer valid) mean the destination is gone", async () => {
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(404) as never })).toEqual({ kind: "gone", status: 404 });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(401) as never })).toEqual({ kind: "gone", status: 401 });
  });

  it("other client errors reject this message for good, without disabling the destination", async () => {
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(400) as never })).toEqual({ kind: "rejected", code: "bad_request" });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(403) as never })).toEqual({ kind: "rejected", code: "forbidden" });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(418) as never })).toEqual({ kind: "rejected", code: "unexpected_status" });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: respond(410) as never })).toEqual({ kind: "rejected", code: "unexpected_status" });
  });

  it("a network failure or a timeout is retried, and the outcome never carries the error's text (it can quote the URL)", async () => {
    const network = vi.fn(async () => {
      throw new TypeError(`fetch failed: connect ECONNREFUSED ${URL_OK}`);
    });
    const outcome = await sendDiscordMessage(URL_OK, {}, { fetch: network as never });
    expect(outcome).toEqual({ kind: "retry", code: "network" });
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: timeout as never })).toEqual({ kind: "retry", code: "timeout" });
    const aborted = vi.fn(async () => {
      throw Object.assign(new Error("x"), { name: "AbortError" });
    });
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: aborted as never })).toEqual({ kind: "retry", code: "timeout" });
  });

  it("really times out a request that never answers", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: (init.signal as AbortSignal).reason?.name ?? "AbortError" })));
    }));
    expect(await sendDiscordMessage(URL_OK, {}, { fetch: hang as never, timeoutMs: 20 })).toEqual({ kind: "retry", code: "timeout" });
  });

  it("no outcome ever contains the webhook URL or its token", async () => {
    for (const status of [204, 301, 400, 401, 403, 404, 418, 429, 500]) {
      const outcome = await sendDiscordMessage(URL_OK, { content: "x" }, { fetch: respond(status, { body: TOKEN }) as never });
      expect(JSON.stringify(outcome), String(status)).not.toContain(TOKEN);
    }
  });
});
