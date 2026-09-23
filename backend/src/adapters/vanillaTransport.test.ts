import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { createVanillaApiTransport } from "./vanillaApiClient.js";

// The real transport uses https.request. These tests inject Node's http.request
// instead, against a real local server: the response object is the same
// IncomingMessage class, so this exercises Node's actual event behavior when a
// connection drops, without needing a TLS certificate in the repo.
const transport = createVanillaApiTransport(http.request as unknown as typeof https.request);

let server: http.Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function serve(handler: http.RequestListener): Promise<number> {
  server = http.createServer(handler);
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("close", () => sockets.forEach((socket) => socket.destroy()));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as AddressInfo).port;
}

function call(port: number) {
  return transport({
    host: "127.0.0.1",
    port,
    timeoutMs: 5_000,
    allowSelfSignedCert: true,
    requestBody: { function: "QueryServerState" },
  });
}

describe("vanilla API transport", () => {
  it("resolves a complete JSON response", async () => {
    const port = await serve((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { ok: true } }));
    });
    await expect(call(port)).resolves.toEqual({ status: 200, body: { data: { ok: true } } });
  });

  // Issue #8, item 1: when the server sent headers and part of the body and then the
  // connection dropped, neither "end" nor the request's "error" fired, so /api/status
  // never answered (the timeout doesn't help once the socket is gone).
  it("rejects as unreachable, instead of hanging, when the connection drops mid-body", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "1000" });
      res.write('{"data": {"serverGameState": ');
      setTimeout(() => res.socket?.destroy(), 20);
    });
    await expect(call(port)).rejects.toMatchObject({ failureKind: "unreachable" });
  }, 3_000);
});
