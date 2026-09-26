import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlertDestinationsResponseSchema,
  AlertEventsResponseSchema,
  AlertRuleResponseSchema,
  AlertRulesResponseSchema,
  AlertStatusResponseSchema,
  DiscordDestinationResponseSchema,
  endpoints,
  SendTestResponseSchema,
} from "@satisfactory-dash/shared";
import { demoNow } from "./clock";
import { resetDemoState } from "./handlers";
import { transport } from "./transport";
import { DEMO_SERVER_ID } from "./world";

// ADR-0027 decision 7: the demo's alerts, through the demo transport like a real visit. Every answer
// is checked with the contract's schema, writes stay in memory, and nothing touches the network.

const S = DEMO_SERVER_ID;
const call = (method: string, path: string, body?: unknown) =>
  transport(path, {
    method,
    credentials: "include",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
const json = async (res: Response) => (await res.json()) as unknown;
const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
  await call("POST", endpoints.auth.login.path(), { username: "demo", password: "demo" });
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("the demo's alerts", () => {
  it("has two alerts firing, the presets plus one production target, and a webhook", async () => {
    const status = AlertStatusResponseSchema.parse(await json(await call("GET", endpoints.alerts.status.path(S))));
    expect(status.firing).toHaveLength(2);
    expect(status.deliveryEnabled).toBe(true);
    const { rules } = AlertRulesResponseSchema.parse(await json(await call("GET", endpoints.alerts.rules.list.path(S))));
    expect(rules.filter((r) => r.preset).map((r) => r.kind).sort()).toEqual(["fuse_trip", "power_outage", "server_unreachable", "stopped_machines"]);
    expect(rules.filter((r) => !r.preset).map((r) => r.kind)).toEqual(["production_below_target"]);
    const { discord } = AlertDestinationsResponseSchema.parse(await json(await call("GET", endpoints.alerts.destinations.get.path(S))));
    expect(discord?.enabled).toBe(true);
  });

  it("logs the two firing alerts and three resolved ones, newest first, a page at a time", async () => {
    const first = AlertEventsResponseSchema.parse(await json(await call("GET", `${endpoints.alerts.events.path(S)}?limit=5`)));
    expect(first.events).toHaveLength(5);
    expect(first.nextBefore).toBe(first.events[4].id);
    const rest = AlertEventsResponseSchema.parse(
      await json(await call("GET", `${endpoints.alerts.events.path(S)}?limit=5&before=${first.nextBefore}`)),
    );
    expect(rest.nextBefore).toBeNull();
    const all = [...first.events, ...rest.events];
    expect(all.filter((e) => e.transition === "resolved")).toHaveLength(3);
    expect(all.map((e) => Date.parse(e.at))).toEqual([...all.map((e) => Date.parse(e.at))].sort((a, b) => b - a));
    expect(all.every((e) => Date.parse(e.at) <= demoNow())).toBe(true);
  });

  it("refuses a bad log page like the backend", async () => {
    const res = await call("GET", `${endpoints.alerts.events.path(S)}?limit=500`);
    expect(res.status).toBe(400);
  });

  it("creates, changes and deletes a production target in memory", async () => {
    const created = await call("POST", endpoints.alerts.rules.create.path(S), {
      kind: "production_below_target",
      params: { item: "Desc_Wire_C", targetPerMinute: 60, windowMinutes: 15 },
    });
    expect(created.status).toBe(201);
    const { rule } = AlertRuleResponseSchema.parse(await json(created));
    expect(rule.preset).toBe(false);
    expect(rule.severity).toBe("warning");

    const moved = await call("PATCH", endpoints.alerts.rules.update.path(S, rule.id), { params: { item: "Desc_Cable_C" } });
    expect(moved.status).toBe(422);
    expect(await codeOf(moved)).toBe("rule_item_immutable");

    const changed = AlertRuleResponseSchema.parse(
      await json(await call("PATCH", endpoints.alerts.rules.update.path(S, rule.id), { params: { targetPerMinute: 90 } })),
    );
    expect(changed.rule.params).toMatchObject({ item: "Desc_Wire_C", targetPerMinute: 90, windowMinutes: 15 });

    expect((await call("DELETE", endpoints.alerts.rules.remove.path(S, rule.id))).status).toBe(200);
    const { rules } = AlertRulesResponseSchema.parse(await json(await call("GET", endpoints.alerts.rules.list.path(S))));
    expect(rules.some((r) => r.id === rule.id)).toBe(false);
  });

  it("won't delete a preset, and turning one off stops its alert firing", async () => {
    const { rules } = AlertRulesResponseSchema.parse(await json(await call("GET", endpoints.alerts.rules.list.path(S))));
    const stopped = rules.find((r) => r.kind === "stopped_machines")!;
    const del = await call("DELETE", endpoints.alerts.rules.remove.path(S, stopped.id));
    expect(del.status).toBe(409);
    expect(await codeOf(del)).toBe("preset_disable_only");
    await call("PATCH", endpoints.alerts.rules.update.path(S, stopped.id), { enabled: false });
    const status = AlertStatusResponseSchema.parse(await json(await call("GET", endpoints.alerts.status.path(S))));
    expect(status.firing.map((f) => f.kind)).toEqual(["production_below_target"]);
  });

  it("keeps only a webhook's last 4 characters, and refuses anything but Discord over https", async () => {
    const url = "https://discord.com/api/webhooks/123/abcdWXYZ";
    const saved = DiscordDestinationResponseSchema.parse(await json(await call("PUT", endpoints.alerts.destinations.putDiscord.path(S), { webhookUrl: url })));
    expect(saved.discord.last4).toBe("WXYZ");
    const read = JSON.stringify(await json(await call("GET", endpoints.alerts.destinations.get.path(S))));
    expect(read).not.toContain("webhooks");

    const http = await call("PUT", endpoints.alerts.destinations.putDiscord.path(S), { webhookUrl: "http://discord.com/api/webhooks/1/x" });
    expect(http.status).toBe(422);
    const other = await call("PUT", endpoints.alerts.destinations.putDiscord.path(S), { webhookUrl: "https://example.com/api/webhooks/1/x" });
    expect(((await json(other)) as { error: { reason: string } }).error.reason).toBe("host_not_allowed");
  });

  it("sends a test without any network call, and says so when there's no webhook", async () => {
    const sent = SendTestResponseSchema.parse(await json(await call("POST", endpoints.alerts.destinations.testDiscord.path(S))));
    expect(sent).toEqual({ ok: true });
    await call("DELETE", endpoints.alerts.destinations.removeDiscord.path(S));
    const none = await call("POST", endpoints.alerts.destinations.testDiscord.path(S));
    expect(none.status).toBe(404);
    expect(await codeOf(none)).toBe("destination_not_configured");
  });

  it("mutes for up to 7 days and unmutes", async () => {
    const soon = new Date(demoNow() + 60 * 60_000).toISOString();
    expect((await call("PUT", endpoints.alerts.mute.set.path(S), { until: soon })).status).toBe(200);
    let status = AlertStatusResponseSchema.parse(await json(await call("GET", endpoints.alerts.status.path(S))));
    expect(status.mutedUntil).toBe(soon);
    const tooLate = new Date(demoNow() + 8 * 24 * 60 * 60_000).toISOString();
    expect(await codeOf(await call("PUT", endpoints.alerts.mute.set.path(S), { until: tooLate }))).toBe("mute_invalid");
    await call("DELETE", endpoints.alerts.mute.clear.path(S));
    status = AlertStatusResponseSchema.parse(await json(await call("GET", endpoints.alerts.status.path(S))));
    expect(status.mutedUntil).toBeNull();
  });

  it("answers a signed-out visitor with 401, like every other demo route", async () => {
    await call("POST", endpoints.auth.logout.path());
    expect((await call("GET", endpoints.alerts.status.path(S))).status).toBe(401);
  });
});
