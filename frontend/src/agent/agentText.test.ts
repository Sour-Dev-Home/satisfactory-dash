import { describe, expect, it } from "vitest";
import { agentBackendUrl, agentVersionLine, canCreateCode, canRevoke, connectionText, gameConnectionView, lastSeenText, versionText } from "./agentText";

describe("gameConnectionView (#740 follow-up)", () => {
  const NOW = Date.parse("2026-10-27T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const enrolled = { enrolled: true, online: true } as const;

  it("is nothing without an agent, or when the agent (or an older backend) reports neither field", () => {
    expect(gameConnectionView({ enrolled: false, gameReachable: true, lastGameReadAt: ago(0) }, NOW)).toBeNull();
    expect(gameConnectionView(enrolled, NOW)).toBeNull();
  });

  it("reachable: ok, with the last read", () => {
    expect(gameConnectionView({ ...enrolled, gameReachable: true, lastGameReadAt: ago(8_000) }, NOW)).toEqual({ tone: "ok", label: "Reachable", lastRead: "last read 8 s ago" });
    expect(gameConnectionView({ ...enrolled, gameReachable: true, lastGameReadAt: ago(500) }, NOW)?.lastRead).toBe("last read just now");
  });

  it("not reachable: warn, with how long ago it last read, or that it never has since starting", () => {
    expect(gameConnectionView({ ...enrolled, gameReachable: false, lastGameReadAt: ago(12 * 60_000) }, NOW)).toEqual({ tone: "warn", label: "Not reachable", lastRead: "last read 12 m ago" });
    expect(gameConnectionView({ ...enrolled, gameReachable: false }, NOW)).toEqual({ tone: "warn", label: "Not reachable", lastRead: "not read since the agent started" });
  });

  it("unknown while the agent is offline (its last word may be stale), still with the last read", () => {
    expect(gameConnectionView({ enrolled: true, online: false, gameReachable: true, lastGameReadAt: ago(3_600_000) }, NOW)).toEqual({
      tone: "unknown",
      label: "Unknown while the agent is offline",
      lastRead: "last read 1 h 0 m ago",
    });
  });

  it("an older backend without `online` is taken at the agent's word", () => {
    expect(gameConnectionView({ enrolled: true, gameReachable: false }, NOW)?.tone).toBe("warn");
  });

  it("a last read with no reachability (an older agent after a newer one) shows the last read only", () => {
    expect(gameConnectionView({ ...enrolled, lastGameReadAt: ago(8_000) }, NOW)).toEqual({ tone: "unknown", label: "Reachability not reported", lastRead: "last read 8 s ago" });
  });

  it("a time from the future counts as now, and an unreadable one says so", () => {
    expect(gameConnectionView({ ...enrolled, gameReachable: true, lastGameReadAt: ago(-30_000) }, NOW)?.lastRead).toBe("last read just now");
    expect(gameConnectionView({ ...enrolled, gameReachable: true, lastGameReadAt: "not a time" }, NOW)?.lastRead).toBe("last read at an unknown time");
  });
});

describe("agentVersionLine", () => {
  it("shows the agent's version once when the sender reports the same, or nothing", () => {
    expect(agentVersionLine("1.4.2", "1.4.2")).toBe("1.4.2");
    expect(agentVersionLine("1.4.2", undefined)).toBe("1.4.2");
    expect(agentVersionLine("0.1.0+abc1234.20261024", "0.1.0+abc1234.20261024")).toBe("0.1.0 (build abc1234, 2026-10-24)");
  });

  it("adds the sender's version when it differs, and falls back to it when the agent's is missing", () => {
    expect(agentVersionLine("1.4.2", "0.9.1")).toBe("1.4.2 · sender 0.9.1");
    expect(agentVersionLine(null, "0.9.1")).toBe("0.9.1");
    expect(agentVersionLine(null, undefined)).toBe("Not reported yet");
  });
});

describe("versionText", () => {
  it("spells out the build of a stamped version", () => {
    expect(versionText("0.1.0+abc1234.20261024")).toBe("0.1.0 (build abc1234, 2026-10-24)");
  });

  it("shows a plain or unknown version as reported", () => {
    expect(versionText("0.1.0")).toBe("0.1.0");
    expect(versionText("weird+thing")).toBe("weird+thing");
  });
});

describe("agentBackendUrl", () => {
  it("uses the configured API origin, without a trailing slash, so the command pastes as is", () => {
    expect(agentBackendUrl("https://api.example.test")).toBe("https://api.example.test");
    expect(agentBackendUrl(" https://api.example.test/ ")).toBe("https://api.example.test");
  });

  it("keeps the placeholder when there's no https origin (development, the demo)", () => {
    expect(agentBackendUrl(undefined)).toBe("https://<your backend>");
    expect(agentBackendUrl("")).toBe("https://<your backend>");
    expect(agentBackendUrl("http://localhost:3001")).toBe("https://<your backend>");
  });
});

const at = "2026-09-26T12:00:05.000Z";
const t = Date.parse(at);

describe("lastSeenText", () => {
  it("counts up the way the rest of the page writes durations", () => {
    expect(lastSeenText(at, t + 8_000)).toBe("Last seen 8 s ago");
    expect(lastSeenText(at, t + 3 * 60_000)).toBe("Last seen 3 m ago");
  });

  it("says just now within the first second, and for a time ahead of this clock", () => {
    expect(lastSeenText(at, t + 999)).toBe("Last seen just now");
    expect(lastSeenText(at, t - 60_000)).toBe("Last seen just now");
  });

  it("says when the agent never reported, or the time can't be read", () => {
    expect(lastSeenText(null, t)).toBe("Hasn't reported yet");
    expect(lastSeenText("not a time", t)).toBe("Last seen at an unknown time");
  });
});

describe("connectionText", () => {
  it("names the two known kinds and passes an unknown one through", () => {
    expect(connectionText("local")).toBe("Directly, from the dashboard's backend");
    expect(connectionText("agent")).toBe("Through the game PC's agent");
    expect(connectionText("relay")).toBe("relay");
  });
});

describe("who may act", () => {
  it("lets only the operator create a code for a server reached directly, whatever their role", () => {
    expect(canCreateCode("local", "owner", false)).toBe(false);
    expect(canCreateCode("local", "viewer", true)).toBe(true);
    expect(canCreateCode("local", undefined, true)).toBe(true);
  });

  it("lets an owner or admin create a code for an agent server", () => {
    expect(canCreateCode("agent", "owner", false)).toBe(true);
    expect(canCreateCode("agent", "admin", false)).toBe(true);
    expect(canCreateCode("agent", "viewer", true)).toBe(false);
    expect(canCreateCode("agent", undefined, false)).toBe(false);
  });

  it("lets an owner or admin revoke", () => {
    expect(canRevoke("owner")).toBe(true);
    expect(canRevoke("admin")).toBe(true);
    expect(canRevoke("viewer")).toBe(false);
    expect(canRevoke(undefined)).toBe(false);
  });
});
