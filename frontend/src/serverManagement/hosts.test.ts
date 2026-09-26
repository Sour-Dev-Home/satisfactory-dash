import { describe, expect, it } from "vitest";
import { isNonLoopbackIpLiteral } from "./hosts";

describe("isNonLoopbackIpLiteral", () => {
  it.each(["192.168.1.20", "10.0.0.5", "172.16.3.4", "8.8.8.8", "::ffff:192.168.1.20", "fe80::1", "[fd00::2]"])(
    "flags %s: an IP literal that isn't this machine",
    (host) => expect(isNonLoopbackIpLiteral(host)).toBe(true),
  );

  it.each(["127.0.0.1", "127.8.9.10", " 127.0.0.1 ", "::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"])(
    "doesn't flag %s: loopback",
    (host) => expect(isNonLoopbackIpLiteral(host)).toBe(false),
  );

  // A hostname can resolve to 127.0.0.1: only the backend can tell, so the browser never flags one.
  it.each(["localhost", "game-server", "game.lan", "", "999.1.1.1"])("doesn't flag %s: not a valid IP literal", (host) =>
    expect(isNonLoopbackIpLiteral(host)).toBe(false),
  );
});
