import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import request from "supertest";
import { ApiErrorResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { SatisfactoryServerAdapter, VanillaApiClient } from "../../gameserver/index.js";
import { createVanillaApiTransport } from "../../gameserver/vanillaApiClient.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createTelemetryRouters, createTelemetryServices } from "../index.js";

/**
 * Architect follow-up to the power history work: a game server that accepts the connection and
 * then trickles bytes forever must end as a 503 upstream_unreachable through the real transport,
 * client, adapter, service and route, not as a request that hangs (the idle-socket timeout alone
 * never fires while bytes keep arriving).
 */
let server: http.Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function trickleServer(): Promise<number> {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"data": ');
    const drip = setInterval(() => res.write(" "), 20);
    res.on("close", () => clearInterval(drip));
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("close", () => sockets.forEach((socket) => socket.destroy()));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as AddressInfo).port;
}

function appAgainst(port: number, timeoutMs: number) {
  // Node's http.request stands in for https.request so no certificate is needed; the client,
  // adapter, service and route are the real ones.
  const transport = createVanillaApiTransport(http.request as unknown as typeof https.request);
  const vanilla = new VanillaApiClient({ host: "127.0.0.1", port, allowSelfSignedCert: true, timeoutMs, transport });
  const adapter = new SatisfactoryServerAdapter(vanilla, { get: async () => [] as never });
  const directory = new InMemoryServerDirectory([
    { id: "default", displayName: "Test server", services: { telemetry: createTelemetryServices(adapter) } },
  ]);
  return createApp({ logger: createLogger(), routers: createTelemetryRouters(directory) });
}

describe("a game server that trickles bytes forever", () => {
  it("is a 503 upstream_unreachable within the deadline, not a hung request", async () => {
    const port = await trickleServer();
    const app = appAgainst(port, 300);
    const started = Date.now();
    const res = await request(app).get(endpoints.status.path("default"));
    const took = Date.now() - started;
    expect(res.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("upstream_unreachable");
    expect(took).toBeGreaterThanOrEqual(250);
    expect(took).toBeLessThan(3_000);
  }, 8_000);

  it("the next request after a timeout is served normally once the server behaves", async () => {
    const port = await trickleServer();
    const app = appAgainst(port, 300);
    expect((await request(app).get(endpoints.status.path("default"))).status).toBe(503);
    // Swap the server's behavior: it now answers properly.
    server!.removeAllListeners("request");
    server!.on("request", (req, res) => {
      req.resume();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { health: "healthy", numSlowTicks: 0 } }));
    });
    const res = await request(app).get(endpoints.status.path("default"));
    expect(res.status).not.toBe(503); // reachable again (any other outcome is about the payload shape)
  }, 8_000);
});
