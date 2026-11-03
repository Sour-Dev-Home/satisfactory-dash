import { describe, expect, it } from "vitest";
import { formatAlertMessage } from "./alertMessage.js";

const message = (transition: "fired" | "renotify" | "resolved", summary: Record<string, unknown> = { silentForSeconds: 150 }) =>
  formatAlertMessage({ kind: "agent_offline", transition, severity: "critical", subject: "agent", summary, serverName: "Home factory", at: 1_800_000_000_000 }).embeds[0]!;

describe("the Discord message of an agent_offline alert (ADR-0031)", () => {
  it("says the game PC stopped reporting, and for about how long", () => {
    const embed = message("fired");
    expect(embed.title).toBe("Game PC offline: it has stopped reporting");
    expect(embed.description).toContain("**Home factory**");
    expect(embed.description).toContain("No snapshot for about 3 min.");
    expect(embed.footer.text).toBe("game PC offline · critical");
  });

  it("says it is still not reporting on a re-notification, and reporting again on resolve (with no duration)", () => {
    expect(message("renotify").title).toBe("Still not reporting: the game PC");
    const resolved = message("resolved");
    expect(resolved.title).toBe("Game PC reporting again");
    expect(resolved.description).not.toContain("No snapshot");
  });

  it("never names the agent: players connect only through the Satis Manager mod (owner, 2026-11-03)", () => {
    for (const transition of ["fired", "renotify", "resolved"] as const) {
      const embed = message(transition);
      expect(`${embed.title} ${embed.description} ${embed.footer.text}`).not.toMatch(/agent/i);
    }
  });

  it("keeps the other kinds' footers spelled out from the kind", () => {
    const embed = formatAlertMessage({ kind: "power_outage", transition: "fired", severity: "warning", subject: "circuit:1", summary: {}, serverName: "Home factory", at: 0 }).embeds[0]!;
    expect(embed.footer.text).toBe("power outage · warning");
  });

  it("keeps every other rule kind's footer as its spelled-out name", () => {
    for (const kind of ["power_outage", "fuse_trip", "stopped_machines", "server_unreachable", "production_below_target"] as const) {
      const embed = formatAlertMessage({ kind, transition: "fired", severity: "info", subject: "server", summary: {}, serverName: "Home factory", at: 0 }).embeds[0]!;
      expect(embed.footer.text).toBe(`${kind.replace(/_/g, " ")} · info`);
    }
  });

  it("rounds the silence to whole minutes, at least one, and tolerates a summary that is not what was recorded", () => {
    expect(message("fired", { silentForSeconds: 40 }).description).toContain("about 1 min");
    expect(message("fired", { silentForSeconds: "long" }).description).not.toContain("No snapshot");
    expect(message("fired", {}).title).toBe("Game PC offline: it has stopped reporting");
  });
});
