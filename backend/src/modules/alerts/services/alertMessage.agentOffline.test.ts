import { describe, expect, it } from "vitest";
import { formatAlertMessage } from "./alertMessage.js";

const message = (transition: "fired" | "renotify" | "resolved", summary: Record<string, unknown> = { silentForSeconds: 150 }) =>
  formatAlertMessage({ kind: "agent_offline", transition, severity: "critical", subject: "agent", summary, serverName: "Home factory", at: 1_800_000_000_000 }).embeds[0]!;

describe("the Discord message of an agent_offline alert (ADR-0031)", () => {
  it("says the agent on the game PC stopped reporting, and for about how long", () => {
    const embed = message("fired");
    expect(embed.title).toBe("Agent offline: the game PC has stopped reporting");
    expect(embed.description).toContain("**Home factory**");
    expect(embed.description).toContain("No snapshot for about 3 min.");
    expect(embed.footer.text).toBe("agent offline · critical");
  });

  it("says it is still offline on a re-notification, and reporting again on resolve (with no duration)", () => {
    expect(message("renotify").title).toBe("Still offline: the agent on the game PC");
    const resolved = message("resolved");
    expect(resolved.title).toBe("Agent reporting again");
    expect(resolved.description).not.toContain("No snapshot");
  });

  it("rounds the silence to whole minutes, at least one, and tolerates a summary that is not what was recorded", () => {
    expect(message("fired", { silentForSeconds: 40 }).description).toContain("about 1 min");
    expect(message("fired", { silentForSeconds: "long" }).description).not.toContain("No snapshot");
    expect(message("fired", {}).title).toBe("Agent offline: the game PC has stopped reporting");
  });
});
