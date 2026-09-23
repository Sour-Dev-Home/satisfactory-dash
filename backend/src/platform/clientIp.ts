import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

function isLoopback(address: string): boolean {
  const plain = address.startsWith("::ffff:") ? address.slice(7) : address;
  return plain === "::1" || /^127\.\d+\.\d+\.\d+$/.test(plain);
}

/**
 * The real client's IP, for login rate limiting and logs (go-live blocker, issue #19).
 *
 * Behind the Cloudflare Tunnel (ADR-0013), cloudflared connects from the same machine,
 * so the socket address is 127.0.0.1 for EVERY visitor -- which would make the login
 * limiters global and let anyone lock the owner out. Cloudflare sends the real
 * address in CF-Connecting-IP. That header is trusted ONLY when the TCP peer is
 * loopback (cloudflared); from any other peer it is ignored, since anyone can send
 * it. Express's `trust proxy` is deliberately left off, so `req.ip` stays the socket
 * address everywhere else.
 */
export function clientIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? "";
  if (isLoopback(peer)) {
    const header = req.headers["cf-connecting-ip"];
    const forwarded = typeof header === "string" ? header.trim() : "";
    if (isIP(forwarded) !== 0) {
      return forwarded;
    }
  }
  return peer || "unknown";
}
