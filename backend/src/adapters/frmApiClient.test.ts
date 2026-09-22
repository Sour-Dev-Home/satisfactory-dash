import { describe, it, expect, vi } from "vitest";
import { FrmApiClient, FrmApiRequestError } from "./frmApiClient.js";
import type { FrmApiFetch } from "./frmApiClient.js";

function buildClient(fetchImpl: FrmApiFetch, authToken?: string) {
  return new FrmApiClient({ host: "localhost", port: 8080, timeoutMs: 1000, authToken, fetchImpl });
}

describe("FrmApiClient", () => {
  it("GETs the endpoint path and returns the parsed JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{ ID: "x" }] });
    const client = buildClient(fetchImpl);
    await expect(client.get("getPlayer")).resolves.toEqual([{ ID: "x" }]);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:8080/getPlayer", expect.objectContaining({ headers: {} }));
  });

  it("sends the auth token as X-FRM-Authorization when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const client = buildClient(fetchImpl, "test-token");
    await client.get("getPlayer");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8080/getPlayer",
      expect.objectContaining({ headers: { "X-FRM-Authorization": "test-token" } }),
    );
  });

  it("throws FrmApiRequestError on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const client = buildClient(fetchImpl);
    await expect(client.get("getUnknown")).rejects.toThrow(FrmApiRequestError);
  });

  it("does not double-wrap or mangle the non-ok status error's message/status", async () => {
    // The non-ok branch now runs inside the broadened try/catch. Make sure the
    // catch's "re-wrap anything that isn't already a FrmApiRequestError" fallback
    // doesn't accidentally catch-and-rewrap this one too (which would garble the
    // message with a nested "FrmApiRequestError: FrmApiRequestError: ..." string
    // and/or lose the `status` field).
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const client = buildClient(fetchImpl);
    await expect(client.get("getUnknown")).rejects.toMatchObject({
      message: "FRM request to getUnknown failed with status 404",
      status: 404,
    });
  });

  it("throws FrmApiRequestError when the fetch itself fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const client = buildClient(fetchImpl);
    await expect(client.get("getPlayer")).rejects.toThrow(FrmApiRequestError);
  });

  // Message no longer folds in String(err) (a second review pass found that once
  // .cause started being unwrapped by formatErrorDetail, the message and the cause
  // chain said the same thing twice) -- the original error's own text now lives
  // only in .cause, which the next test covers.
  it("wraps a fetch-level rejection with a plain message and no status", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const client = buildClient(fetchImpl);
    await expect(client.get("getPlayer")).rejects.toMatchObject({
      message: "FRM request to getPlayer failed",
      status: undefined,
    });
  });

  it("throws FrmApiRequestError (not a raw SyntaxError) when an ok response body isn't valid JSON", async () => {
    // Previously get() only wrapped errors from fetchImpl itself in a try/catch;
    // res.json() ran unguarded, so a 200 response with a malformed body threw a raw
    // SyntaxError instead of this client's own typed, catchable error.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
    const client = buildClient(fetchImpl);
    await expect(client.get("getFactory")).rejects.toThrow(FrmApiRequestError);
    await expect(client.get("getFactory")).rejects.toMatchObject({
      message: "FRM request to getFactory failed",
      status: undefined,
    });
  });

  // Found by an independent review pass: the wrapped error only carried the
  // original error's String()-ified message, not the original error itself as
  // .cause -- so formatErrorDetail.ts's .cause-unwrapping never actually had
  // anything real to unwrap for FRM-backed routes in practice, despite existing
  // specifically for that purpose (its own doc comment cites this exact client).
  it("sets the original error as .cause on a fetch-level rejection", async () => {
    const original = new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    const fetchImpl = vi.fn().mockRejectedValue(original);
    const client = buildClient(fetchImpl);
    await expect(client.get("getPlayer")).rejects.toMatchObject({ cause: original });
  });

  it("passes an AbortSignal derived from the configured timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const client = buildClient(fetchImpl);
    await client.get("getPlayer");
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
