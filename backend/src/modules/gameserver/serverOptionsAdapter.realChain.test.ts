import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { ServerOptionsAdapter } from "./serverOptionsAdapter.js";
import { VanillaApiClient, createVanillaApiTransport } from "./vanillaApiClient.js";

// The REAL chain (ServerOptionsAdapter -> VanillaApiClient -> real transport) against a real
// local server that applies the write and then loses the response. SettingsService's re-read
// branch keys on `failureKind: "unreachable"` surviving the adapter's `scrubbed()` rebuild.
let server: http.Server | undefined;
const sockets = new Set<Socket>();
afterEach(async () => {
  sockets.forEach((s) => s.destroy());
  sockets.clear();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

type WriteMode = "drop" | "stall" | "drop-mid-body" | "http500";

async function fakeGame(mode: WriteMode, secret = "SECRET-TOKEN-VALUE") {
  const state = { autoPause: "False", writes: 0 };
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { function: string; data?: { UpdatedServerOptions: Record<string, string> } };
      if (body.function === "GetServerOptions") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            data: {
              serverOptions: { "FG.DSAutoPause": state.autoPause, "uWS.AuthenticationToken": secret },
              pendingServerOptions: {},
            },
          }),
        );
        return;
      }
      state.writes += 1;
      state.autoPause = body.data!.UpdatedServerOptions["FG.DSAutoPause"]; // applied first
      if (mode === "drop") res.socket?.destroy();
      else if (mode === "drop-mid-body") {
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "500" });
        res.write("{");
        setTimeout(() => res.socket?.destroy(), 10);
      } else if (mode === "http500") {
        res.statusCode = 500;
        res.end();
      }
      // "stall": never answer
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const client = new VanillaApiClient({
    host: "127.0.0.1",
    port,
    allowSelfSignedCert: true,
    timeoutMs: 1_500, // generous: only "stall" waits for it; the rest must not race a loaded machine
    transport: createVanillaApiTransport(http.request as unknown as typeof https.request),
  });
  return { state, adapter: new ServerOptionsAdapter(client, undefined) };
}

describe("ServerOptionsAdapter.applyAutoPause through the real client and transport", () => {
  it.each(["drop", "stall", "drop-mid-body"] as const)(
    "a write whose response is lost (%s) rejects with failureKind unreachable, after the server applied it",
    async (mode) => {
      const { state, adapter } = await fakeGame(mode);
      const err = await adapter.applyAutoPause(true).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toMatchObject({ name: "UpstreamError", failureKind: "unreachable" });
      expect(state.writes).toBe(1);
      // the read-back then sees the requested value, and only the allowlisted booleans
      const read = await adapter.readAutoPause();
      expect(read).toEqual({ autoPause: true, pending: false });
      expect(JSON.stringify(err)).not.toContain("SECRET-TOKEN-VALUE");
      expect(String((err as Error).message)).not.toContain("SECRET-TOKEN-VALUE");
    },
    8_000,
  );

  it("a plain HTTP 500 is NOT unreachable (so it is never read back)", async () => {
    const { adapter } = await fakeGame("http500");
    const err = await adapter.applyAutoPause(true).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ status: 500 });
    expect((err as { failureKind?: string }).failureKind).not.toBe("unreachable");
  });
});
