import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "./connectionConfig.js";

describe("isLoopbackHost edge cases", () => {
  it.each(["127.0.0.1.evil.com", "0127.0.0.1", "127.0.0.1.", "localhost.evil.com", "evil.com/localhost", "::ffff:10.0.0.1", "::2", "128.0.0.1", "1270.0.0.1", "", "0.0.0.0", "::"])(
    "%j is not loopback",
    (h) => expect(isLoopbackHost(h)).toBe(false),
  );
  it.each(["127.0.0.1", "127.255.255.254", "LOCALHOST", " localhost ", "[::1]", "::1", "::ffff:127.0.0.1", "::FFFF:127.1.2.3", "a.localhost"])(
    "%j is loopback",
    (h) => expect(isLoopbackHost(h)).toBe(true),
  );
});
