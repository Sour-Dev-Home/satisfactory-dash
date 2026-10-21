import { describe, it, expect } from "vitest";
import { ownValue } from "@satisfactory-dash/shared";
import { METRIC_REGISTRY, UnknownMetricError, InvalidLabelError, validateRecording, isBoundedToken, isStatusClass, isOneOf, QUERY_NAMES } from "./registry.js";

describe("validateRecording (ADR-0037 §1: a fixed registry, closed-set labels)", () => {
  it("accepts a correctly-labelled recording of a known metric", () => {
    expect(() => validateRecording("http.server.request.duration", "histogram", { route: "/servers/:serverId/status", status_class: "2xx" })).not.toThrow();
  });

  it("refuses a metric that is not in the registry", () => {
    expect(() => validateRecording("totally.made.up", "histogram", {})).toThrow(UnknownMetricError);
  });

  it("refuses a metric recorded as the wrong kind", () => {
    expect(() => validateRecording("http.server.request.duration", "counter", { route: "/x", status_class: "2xx" })).toThrow(InvalidLabelError);
  });

  it("refuses an undeclared label key", () => {
    expect(() =>
      validateRecording("http.server.request.duration", "histogram", { route: "/x", status_class: "2xx", user: "someone" }),
    ).toThrow(InvalidLabelError);
  });

  it("refuses a missing required label", () => {
    expect(() => validateRecording("http.server.request.duration", "histogram", { route: "/x" })).toThrow(InvalidLabelError);
  });

  it("refuses a label value outside its allowed set", () => {
    expect(() => validateRecording("http.server.request.duration", "histogram", { route: "/x", status_class: "banana" })).toThrow(InvalidLabelError);
    expect(() => validateRecording("http.server.upstream.duration", "histogram", { api: "not-a-real-api" })).toThrow(InvalidLabelError);
  });

  it("refuses a label key that shadows an inherited Object.prototype member (no bypass via `in`)", () => {
    // `"toString" in {}` is true (inherited), so a naive `!(key in definition.labels)` check would
    // let this sail through with its value never run against any predicate. Object.hasOwn is what
    // must be used instead.
    const labels = JSON.parse(
      '{"route":"/x","status_class":"2xx","toString":"http://evil.example.com/pwned?token=secret and spaces"}',
    );
    expect(() => validateRecording("http.server.request.duration", "histogram", labels)).toThrow(InvalidLabelError);
  });

  it("refuses a label set with an own '__proto__' key from JSON.parse (a real own property, not the object-literal special case)", () => {
    const labels = JSON.parse(
      '{"route":"/x","status_class":"2xx","__proto__":"free text with spaces and @ and ? and <script>"}',
    );
    expect(() => validateRecording("http.server.request.duration", "histogram", labels)).toThrow(InvalidLabelError);
  });

  it("refuses a metric name that collides with an inherited Object.prototype member as UnknownMetricError, not a confusing kind mismatch", () => {
    for (const name of ["__proto__", "toString", "constructor", "hasOwnProperty", "valueOf"]) {
      expect(() => validateRecording(name, "histogram", {}), name).toThrow(UnknownMetricError);
    }
  });

  it("every metric in the registry is reachable with an all-valid label set (no metric is unrecordable by construction)", () => {
    const sample: Record<string, string> = {
      route: "/servers/:serverId/status",
      status_class: "2xx",
      status: "429",
      api: "vanilla",
      query: "servers.lockServerByPublicId",
      server: "abc123",
      group: "power",
      table: "power_samples",
      kind: "power_outage",
    };
    for (const [metric, definition] of Object.entries(METRIC_REGISTRY)) {
      const labels: Record<string, string> = {};
      for (const key of Object.keys(definition.labels)) labels[key] = sample[key];
      expect(() => validateRecording(metric, definition.kind, labels)).not.toThrow();
    }
  });
});

describe("the background metrics (ADR-0037 §1, build step 3)", () => {
  // Each metric with exactly the label keys the ADR's table gives, and one valid value per key.
  const table: [string, "histogram" | "counter", Record<string, string>][] = [
    ["satis.poller.cycle.duration", "histogram", { server: "abc123", group: "power" }],
    ["satis.poller.lag", "histogram", { server: "abc123", group: "factory" }],
    ["satis.agent.ingest.lag", "histogram", { server: "abc123" }],
    ["satis.agent.refused", "counter", { server: "unknown", status: "401" }],
    ["satis.history.rows_written", "counter", { table: "item_samples" }],
    ["satis.history.rows_dropped", "counter", { server: "abc123", table: "power_samples" }],
    ["satis.alerts.evaluation.duration", "histogram", {}],
    ["satis.alerts.fire.lag", "histogram", { kind: "fuse_trip" }],
    ["satis.alerts.events_dropped", "counter", { server: "abc123" }],
  ];

  it.each(table)("%s is registered as a %s with exactly its table's labels", (metric, kind, labels) => {
    expect(Object.keys(ownValue(METRIC_REGISTRY, metric)?.labels ?? { missing: true }).sort()).toEqual(Object.keys(labels).sort());
    expect(() => validateRecording(metric, kind, labels)).not.toThrow();
  });

  it.each(table)("%s refuses a value outside each of its label sets", (metric, kind, labels) => {
    for (const key of Object.keys(labels)) {
      expect(() => validateRecording(metric, kind, { ...labels, [key]: "not a member" }), key).toThrow(InvalidLabelError);
    }
  });

  it("refuses an endpoint group, history table or alert kind that is a valid token but not in its set", () => {
    expect(() => validateRecording("satis.poller.lag", "histogram", { server: "abc123", group: "status" })).toThrow(InvalidLabelError);
    expect(() => validateRecording("satis.history.rows_written", "counter", { table: "power_rollups" })).toThrow(InvalidLabelError);
    expect(() => validateRecording("satis.alerts.fire.lag", "histogram", { kind: "made_up_kind" })).toThrow(InvalidLabelError);
    expect(() => validateRecording("satis.agent.refused", "counter", { server: "abc123", status: "500" })).toThrow(InvalidLabelError);
  });

  it("still refuses an unregistered satis.* name", () => {
    expect(() => validateRecording("satis.poller.made_up", "histogram", { server: "abc123", group: "power" })).toThrow(UnknownMetricError);
  });
});

describe("no label in the registry can carry a URL or a user identifier (ADR-0037 §1)", () => {
  it("no metric declares a label key that names a person or a raw request target", () => {
    const forbiddenKeyPattern = /url|user|email|ip$|ip_|username|name$/i;
    for (const [metric, definition] of Object.entries(METRIC_REGISTRY)) {
      for (const key of Object.keys(definition.labels)) {
        expect(key, `${metric}'s label "${key}"`).not.toMatch(forbiddenKeyPattern);
      }
    }
  });

  it("isBoundedToken refuses anything shaped like a URL, an email, or free text with whitespace", () => {
    const check = isBoundedToken(200);
    expect(check("https://example.com/x?token=abc")).toBe(false); // "?" and "://" style content
    expect(check("someone@example.com")).toBe(false); // "@"
    expect(check("free text with spaces")).toBe(false);
    expect(check("")).toBe(false);
    expect(check("a".repeat(201))).toBe(false); // over the bound
    expect(check("/servers/:serverId/status")).toBe(true);
  });

  it("isStatusClass and isOneOf only accept their fixed set", () => {
    expect(isStatusClass("2xx")).toBe(true);
    expect(isStatusClass("200")).toBe(false);
    expect(isStatusClass("6xx")).toBe(false);
    const flag = isOneOf("vanilla", "frm");
    expect(flag("vanilla")).toBe(true);
    expect(flag("mystery-api")).toBe(false);
  });
});

describe("db.client.operation.duration's query names (ADR-0037 build step 4)", () => {
  it("accepts only a registered query name as the `query` label", () => {
    expect(() => validateRecording("db.client.operation.duration", "histogram", { query: "identity.getUserById" })).not.toThrow();
    for (const stray of ["identity.getUserByIdX", "SELECT 1", "", "someone@example.com", "toString", "__proto__"]) {
      expect(() => validateRecording("db.client.operation.duration", "histogram", { query: stray }), stray).toThrow(InvalidLabelError);
    }
  });

  it("every registered name is a short, bounded, dotted token", () => {
    for (const name of QUERY_NAMES) {
      expect(isBoundedToken(200)(name), name).toBe(true);
      expect(name, name).toMatch(/^[a-z]+(\.[A-Za-z_]+)+$/);
    }
  });
});
