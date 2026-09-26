import { describe, expect, it } from "vitest";
import { agentBackendUrl, canCreateCode, canRevoke, connectionText, lastSeenText } from "./agentText";

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
