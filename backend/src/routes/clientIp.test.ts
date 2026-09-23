import { describe, it, expect } from "vitest";
import type { Request } from "express";
import request from "supertest";
import { clientIp } from "./clientIp.js";
import { createApp } from "../app.js";
import { createLogger } from "../logger.js";
import { healthRouter } from "./health.js";

function fakeRequest(remoteAddress: string | undefined, cfConnectingIp?: string | string[]): Request {
  const headers: Record<string, string | string[]> = {};
  if (cfConnectingIp !== undefined) {
    headers["cf-connecting-ip"] = cfConnectingIp;
  }
  return { socket: { remoteAddress }, headers } as unknown as Request;
}

describe("clientIp", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.8.9.10"])(
    "trusts CF-Connecting-IP from the local tunnel (peer %s)",
    (peer) => {
      expect(clientIp(fakeRequest(peer, "203.0.113.5"))).toBe("203.0.113.5");
      expect(clientIp(fakeRequest(peer, "2001:db8::7"))).toBe("2001:db8::7");
    },
  );

  // Anyone can send this header, so it must count only from cloudflared on this machine.
  it.each(["10.0.0.9", "192.168.1.20", "203.0.113.200", "::ffff:10.0.0.9"])(
    "ignores a spoofed CF-Connecting-IP from a non-loopback peer (%s)",
    (peer) => {
      expect(clientIp(fakeRequest(peer, "1.2.3.4"))).toBe(peer);
    },
  );

  it("falls back to the socket address when the tunnel sends no header", () => {
    expect(clientIp(fakeRequest("127.0.0.1"))).toBe("127.0.0.1");
  });

  it.each(["", "not-an-ip", "1.2.3.4, 5.6.7.8", "1.2.3.4:5678"])(
    "ignores a malformed header value %j",
    (value) => {
      expect(clientIp(fakeRequest("127.0.0.1", value))).toBe("127.0.0.1");
    },
  );

  it("ignores a repeated header rather than picking one", () => {
    expect(clientIp(fakeRequest("127.0.0.1", ["1.2.3.4", "5.6.7.8"]))).toBe("127.0.0.1");
  });

  it("never returns an empty string", () => {
    expect(clientIp(fakeRequest(undefined))).toBe("unknown");
  });
});

// Architect request (go-live observability): behind the tunnel the raw socket address
// is 127.0.0.1 for everyone, so every request line also carries the resolved client IP.
// The raw address stays in req.remoteAddress, so a spoof shows as a mismatch.
describe("request logs", () => {
  it("record the resolved client IP on every request, next to the raw socket address", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) });
    const app = createApp({ logger, routers: [healthRouter] });
    await request(app).get("/api/health").set("CF-Connecting-IP", "203.0.113.9");
    const completed = lines.find((line) => line.msg === "request completed")!;
    expect(completed.clientIp).toBe("203.0.113.9");
    expect(String((completed.req as { remoteAddress: string }).remoteAddress)).toMatch(/127\.0\.0\.1|::1/);
  });
});
