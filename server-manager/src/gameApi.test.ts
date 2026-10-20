import type { VanillaApiTransport } from "@satisfactory-dash/game-adapter";
import { describe, expect, it } from "vitest";
import { createGameApi, GAME_API_TIMEOUT_MS, redact } from "./gameApi";

const TOKEN = "app-token-123";

function fakeTransport(answer: (fn: string) => { status: number; body: unknown } | Error) {
  const requests: Parameters<VanillaApiTransport>[0][] = [];
  const transport: VanillaApiTransport = async (payload) => {
    requests.push(payload);
    const result = answer((payload.requestBody as { function: string }).function);
    if (result instanceof Error) throw result;
    return result;
  };
  return { transport, requests };
}

const api = (transport: VanillaApiTransport) => createGameApi({ host: "127.0.0.1", port: 7777, token: TOKEN, transport });

describe("createGameApi", () => {
  it("reads the active session name from QueryServerState", async () => {
    const { transport, requests } = fakeTransport(() => ({
      status: 200,
      body: { data: { serverGameState: { activeSessionName: "my-world", numConnectedPlayers: 0 } } },
    }));
    await expect(api(transport).sessionName()).resolves.toBe("my-world");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      host: "127.0.0.1",
      port: 7777,
      authToken: TOKEN,
      allowSelfSignedCert: true,
      timeoutMs: GAME_API_TIMEOUT_MS,
      requestBody: { function: "QueryServerState" },
    });
  });

  it("saves with SaveName, then shuts down with no data", async () => {
    const { transport, requests } = fakeTransport(() => ({ status: 204, body: undefined }));
    const game = api(transport);
    await game.saveGame("my-world");
    await game.shutdown();
    expect(requests.map((r) => r.requestBody)).toEqual([
      { function: "SaveGame", data: { SaveName: "my-world" } },
      { function: "Shutdown" },
    ]);
    expect(requests.every((r) => r.authToken === TOKEN && r.port === 7777)).toBe(true);
  });

  it("edge: no active session is an error, not an empty save name", async () => {
    for (const body of [
      { data: { serverGameState: { activeSessionName: "   " } } },
      { data: { serverGameState: {} } },
      { data: {} },
      { data: null },
    ]) {
      const { transport } = fakeTransport(() => ({ status: 200, body }));
      await expect(api(transport).sessionName()).rejects.toThrow("no active session");
    }
  });

  it("edge: an API error names the call and never carries the token", async () => {
    const { transport } = fakeTransport(() => ({
      status: 401,
      body: { errorCode: "invalid_token", errorMessage: `token ${TOKEN} is not valid` },
    }));
    const err = await api(transport).saveGame("w").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("SaveGame failed");
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).toContain("[token]");
  });

  it("edge: a transport failure is redacted too", async () => {
    const { transport } = fakeTransport(() => new Error(`connect ECONNREFUSED (Bearer ${TOKEN})`));
    const err = (await api(transport).shutdown().catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("Shutdown failed");
    expect(err.message).not.toContain(TOKEN);
  });

  it("edge: redact leaves text alone for an empty token and cuts every copy", () => {
    expect(redact("abc", "")).toBe("abc");
    expect(redact("x-T-y-T", "T")).toBe("x-[token]-y-[token]");
  });
});
