import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type https from "node:https";
import net from "node:net";
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

function call(port: number, timeoutMs = 5_000) {
  return transport({
    host: "127.0.0.1",
    port,
    timeoutMs,
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

  // Node's `timeout` option is an IDLE-socket timeout: it never fires while bytes keep
  // arriving. The overall deadline (AbortSignal.timeout, like FRM's) is what stops a game
  // server that accepts the connection and then trickles, from holding a request, or the
  // power history poller, open forever.
  describe("the overall per-request deadline", () => {
    const timed = async (run: () => Promise<unknown>) => {
      const started = Date.now();
      const outcome = await run().then(
        () => ({ ok: true as const }),
        (err: unknown) => ({ ok: false as const, err }),
      );
      return { ...outcome, ms: Date.now() - started };
    };

    it("rejects as unreachable when the body trickles in forever (the idle timeout never fires)", async () => {
      const port = await serve((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" }); // chunked: no Content-Length
        res.write('{"data": ');
        const drip = setInterval(() => res.write(" "), 20);
        res.on("close", () => clearInterval(drip));
      });
      const result = await timed(() => call(port, 300));
      expect(result.ok).toBe(false);
      expect((result as { err: unknown }).err).toMatchObject({ failureKind: "unreachable" });
      expect(result.ms).toBeGreaterThanOrEqual(250);
      expect(result.ms).toBeLessThan(3_000);
    }, 6_000);

    it("rejects as unreachable when the response HEADERS trickle in forever", async () => {
      const slow = net.createServer((socket) => {
        socket.on("error", () => {});
        socket.write("HTTP/1.1 200 OK\r\n");
        const drip = setInterval(() => socket.write("X-Slow: yes\r\n"), 20); // the head never ends
        socket.on("close", () => clearInterval(drip));
      });
      await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
      try {
        const port = (slow.address() as AddressInfo).port;
        const result = await timed(() => call(port, 300));
        expect(result.ok).toBe(false);
        expect((result as { err: unknown }).err).toMatchObject({ failureKind: "unreachable" });
        expect(result.ms).toBeLessThan(3_000);
      } finally {
        await new Promise<void>((resolve) => slow.close(() => resolve()));
      }
    }, 6_000);

    it("rejects as unreachable when the server accepts the connection and never answers", async () => {
      const port = await serve(() => {
        /* never respond */
      });
      const result = await timed(() => call(port, 300));
      expect(result.ok).toBe(false);
      expect((result as { err: unknown }).err).toMatchObject({ failureKind: "unreachable" });
      expect(result.ms).toBeLessThan(3_000);
    }, 6_000);

    it("leaves a response that completes in time alone", async () => {
      const port = await serve((_req, res) => {
        setTimeout(() => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: { ok: true } }));
        }, 100);
      });
      // A generous deadline: the response takes ~100 ms, so this never waits for it, and a
      // stalled local connect on a loaded machine can't eat it.
      await expect(call(port, 10_000)).resolves.toEqual({ status: 200, body: { data: { ok: true } } });
    }, 15_000);

    it("a slow but steady response that finishes inside the deadline still resolves", async () => {
      const port = await serve((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"data": ');
        setTimeout(() => res.write('{"ok": '), 80);
        setTimeout(() => res.end("true}}"), 160);
      });
      await expect(call(port, 10_000)).resolves.toEqual({ status: 200, body: { data: { ok: true } } });
    }, 15_000);

    it("every request gets a fresh deadline: an earlier timeout does not make later ones fail instantly", async () => {
      const port = await serve(() => {
        /* never respond */
      });
      const first = await timed(() => call(port, 300));
      const second = await timed(() => call(port, 300));
      for (const result of [first, second]) {
        expect(result.ok).toBe(false);
        expect(result.ms).toBeGreaterThanOrEqual(250); // each waited out its own deadline
      }
    }, 6_000);
  });
});
