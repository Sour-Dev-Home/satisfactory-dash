import { describe, it, expect, vi } from "vitest";
import { VanillaApiClient, VanillaApiRequestError } from "./vanillaApiClient.js";
import type { VanillaApiTransport } from "./vanillaApiClient.js";

function buildClient(transport: VanillaApiTransport) {
  return new VanillaApiClient({
    host: "localhost",
    port: 7777,
    allowSelfSignedCert: true,
    timeoutMs: 1000,
    transport,
  });
}

describe("VanillaApiClient", () => {
  it("returns the data field on a Success Response", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: { data: { health: "healthy" } } });
    const client = buildClient(transport);
    await expect(client.call("HealthCheck")).resolves.toEqual({ health: "healthy" });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { function: "HealthCheck" } }),
    );
  });

  it("includes the data payload in the request body when provided", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: { data: {} } });
    const client = buildClient(transport);
    await client.call("HealthCheck", { ClientCustomData: "x" });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { function: "HealthCheck", data: { ClientCustomData: "x" } } }),
    );
  });

  it("returns undefined for a 204 No Content response", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 204, body: undefined });
    const client = buildClient(transport);
    await expect(client.call("Shutdown")).resolves.toBeUndefined();
  });

  it("throws VanillaApiRequestError on an Error Response body", async () => {
    const transport = vi.fn().mockResolvedValue({
      status: 200,
      body: { errorCode: "wrong_password", errorMessage: "bad password" },
    });
    const client = buildClient(transport);
    await expect(client.call("PasswordLogin")).rejects.toThrow(VanillaApiRequestError);
    await expect(client.call("PasswordLogin")).rejects.toMatchObject({ errorCode: "wrong_password" });
  });

  it("throws VanillaApiRequestError on a non-2xx status with no error body", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 500, body: undefined });
    const client = buildClient(transport);
    await expect(client.call("HealthCheck")).rejects.toThrow(VanillaApiRequestError);
  });

  it("throws VanillaApiRequestError (not a raw TypeError) when a 2xx body is JSON null", async () => {
    // JSON.parse("null") yields `null`, which is neither an error body (isErrorBody
    // requires `body !== null`) nor `undefined`. Previously the client fell through
    // to `(body as { data: T }).data`, which throws an unwrapped TypeError on
    // `null.data` instead of the client's own typed, catchable error.
    const transport = vi.fn().mockResolvedValue({ status: 200, body: null });
    const client = buildClient(transport);
    await expect(client.call("HealthCheck")).rejects.toThrow(VanillaApiRequestError);
  });

  it("returns undefined (not a crash) when a 2xx body is a bare JSON primitive", async () => {
    // A non-null, non-object success body (e.g. `true` or a string) also isn't an
    // error body; indexing `.data` off a primitive doesn't throw in JS, it just
    // yields undefined, unlike the `null` case above.
    const transport = vi.fn().mockResolvedValue({ status: 200, body: true });
    const client = buildClient(transport);
    await expect(client.call("HealthCheck")).resolves.toBeUndefined();
  });

  it("returns undefined for bare JSON primitives other than booleans too (number, string)", async () => {
    // Guard against a fix that over-broadly rejects "not a plain object" bodies
    // instead of specifically rejecting `null` — numbers and strings must behave
    // the same as the `true` case above.
    const numberTransport = vi.fn().mockResolvedValue({ status: 200, body: 42 });
    await expect(buildClient(numberTransport).call("HealthCheck")).resolves.toBeUndefined();

    const stringTransport = vi.fn().mockResolvedValue({ status: 200, body: "ok" });
    await expect(buildClient(stringTransport).call("HealthCheck")).resolves.toBeUndefined();
  });

  it("reports a specific, sensible message and no bogus error fields for a null success body", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: null });
    const client = buildClient(transport);
    await expect(client.call("HealthCheck")).rejects.toMatchObject({
      message: "Vanilla API returned a null success body",
      errorCode: undefined,
      errorData: undefined,
    });
  });

  it("still resolves undefined for a 204 response even if the transport also supplied a null body", async () => {
    // The 204/undefined short-circuit must run before the null-body check, so a
    // (hypothetical) null body on a No Content response doesn't get misclassified
    // as the null-success-body error case.
    const transport = vi.fn().mockResolvedValue({ status: 204, body: null });
    const client = buildClient(transport);
    await expect(client.call("Shutdown")).resolves.toBeUndefined();
  });

  it("treats errorMessage as optional and falls back to errorCode as the thrown message", async () => {
    const transport = vi.fn().mockResolvedValue({
      status: 200,
      body: { errorCode: "unauthorized" },
    });
    const client = buildClient(transport);
    await expect(client.call("Shutdown")).rejects.toMatchObject({
      message: "unauthorized",
      errorCode: "unauthorized",
    });
  });
});
