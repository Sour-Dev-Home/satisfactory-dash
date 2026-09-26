import { describe, expect, it } from "vitest";
import { alertEventsLastPage, alertEventsPage, alertRulesList } from "@satisfactory-dash/shared/fixtures";
import { alertTitle, disabledReasonText, eventDetail, itemOf, kindLabel, severityClass, severityLabel, subjectLabel, transitionLabel } from "./alertText";

describe("alert words", () => {
  it("names every known kind, and spells out one a newer backend adds", () => {
    expect(kindLabel("power_outage")).toBe("Power outage");
    expect(kindLabel("server_unreachable")).toBe("Game server unreachable");
    expect(kindLabel("agent_offline")).toBe("Agent offline");
  });

  it("names severities and transitions, with a readable fallback", () => {
    expect(severityLabel("critical")).toBe("Critical");
    expect(severityLabel("page_me")).toBe("Page me");
    expect(severityClass("critical")).toBe("text-bad");
    expect(severityClass("page_me")).toBe("text-muted");
    expect(transitionLabel("renotify")).toBe("Still going");
    expect(transitionLabel("escalated")).toBe("Escalated");
  });

  it("names what an alert is about, including an item only the summary or rule knows", () => {
    expect(subjectLabel("circuit:3")).toBe("Circuit 3");
    expect(subjectLabel("server")).toBe("The game server");
    expect(subjectLabel("group")).toBe("Machines");
    expect(subjectLabel("item", "Desc_IronPlate_C")).toBe("Iron Plate");
    expect(subjectLabel("item")).toBe("An item");
    expect(subjectLabel("something:new")).toBe("something:new");
  });

  it("titles an alert without repeating the kind in the subject", () => {
    expect(alertTitle("stopped_machines", "group")).toBe("Stopped machines");
    expect(alertTitle("server_unreachable", "server")).toBe("Game server unreachable");
    expect(alertTitle("power_outage", "circuit:3")).toBe("Power outage: Circuit 3");
    expect(alertTitle("production_below_target", "item", "Desc_IronPlate_C")).toBe("Production below target: Iron Plate");
    expect(alertTitle("agent_offline", "agent:pc-1")).toBe("Agent offline: agent:pc-1");
  });

  it("finds the item in a rule's params or an event's summary, and nothing else", () => {
    const target = alertRulesList.rules.find((r) => r.kind === "production_below_target");
    expect(itemOf(target?.params)).toMatch(/^Desc_/);
    expect(itemOf({ item: 7 })).toBeUndefined();
    expect(itemOf({ item: "" })).toBeUndefined();
    expect(itemOf(undefined)).toBeUndefined();
  });

  it("says why the Discord destination is off, or nothing while it's on", () => {
    expect(disabledReasonText(null)).toBeNull();
    expect(disabledReasonText("webhook_gone")).toMatch(/no longer exists/);
    expect(disabledReasonText("quota")).toBe("Turned off (quota).");
  });
});

describe("eventDetail", () => {
  const events = [...alertEventsPage.events, ...alertEventsLastPage.events];

  it("describes each known kind in the fixtures from its summary", () => {
    const production = events.find((e) => e.kind === "production_below_target" && e.transition === "fired");
    expect(production && eventDetail(production)).toBe("Iron Plate: 84.2 per min against a target of 120 per min over 10 min.");
    const stopped = events.find((e) => e.kind === "stopped_machines");
    expect(stopped && eventDetail(stopped)).toMatch(/^\d+ machines? stopped/);
    const outage = events.find((e) => e.kind === "power_outage");
    expect(outage && eventDetail(outage)).toMatch(/^Circuit \d+ lost power\.$/);
  });

  it("leaves out the average on a reminder sent while the window refills", () => {
    const reminder = { kind: "production_below_target", summary: { item: "Desc_IronPlate_C", targetPerMinute: 120, windowMinutes: 10 } };
    expect(eventDetail(reminder)).toBe("Iron Plate: target 120 per min over 10 min.");
  });

  it("names the missing input of a stopped machine", () => {
    const summary = { machines: 1, byRecipe: [], byReason: [{ reason: "input short: Desc_Coal_C", count: 1 }] };
    expect(eventDetail({ kind: "stopped_machines", summary })).toBe("1 machine stopped: 1 short of Coal.");
  });

  it("gives nothing for an unknown kind or a summary that doesn't match its kind", () => {
    expect(eventDetail({ kind: "agent_offline", summary: {} })).toBeNull();
    expect(eventDetail({ kind: "power_outage", summary: { circuit: "one" } })).toBeNull();
  });
});
