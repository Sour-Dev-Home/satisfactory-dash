import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SnapshotRequestSchema } from "@satisfactory-dash/shared";
import { buildStamp } from "../scripts/build.mjs";
import { AGENT_VERSION, BASE_VERSION, buildDateOf, composeVersion } from "./version.js";

describe("agent version", () => {
  it("BASE_VERSION matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(BASE_VERSION).toBe(pkg.version);
  });

  it("is the plain release when the build injected no stamp (tests, no git)", () => {
    expect(AGENT_VERSION).toBe(BASE_VERSION);
  });

  it("appends the sha and date of the build", () => {
    expect(composeVersion("0.1.0", "abc1234.20261024")).toBe("0.1.0+abc1234.20261024");
  });

  it("falls back to the plain release for a missing or malformed stamp", () => {
    expect(composeVersion("0.1.0", undefined)).toBe("0.1.0");
    expect(composeVersion("0.1.0", "")).toBe("0.1.0");
    expect(composeVersion("0.1.0", "not a stamp")).toBe("0.1.0");
  });

  it("reads the build date back out of a reported version", () => {
    expect(buildDateOf("0.1.0+abc1234.20261024")).toBe("2026-10-24");
    expect(buildDateOf("0.1.0")).toBeNull();
    expect(buildDateOf("garbage")).toBeNull();
  });

  it("the stamped form fits the contract's snapshot schema (32 characters)", () => {
    const stamped = composeVersion(BASE_VERSION, "abcdef123456.20261024");
    expect(stamped.length).toBeLessThanOrEqual(32);
    const body = { agentVersion: stamped, observedAt: "2026-10-24T10:00:00Z", reachable: false, paused: null };
    expect(SnapshotRequestSchema.safeParse(body).success).toBe(true);
  });

  it("the build script's stamp is sha.date from the checkout, or null without git", () => {
    const stamp = buildStamp(new Date("2026-10-24T23:59:59Z"));
    if (stamp !== null) expect(stamp).toMatch(/^[0-9a-f]{4,12}\.20261024$/);
  });
});
