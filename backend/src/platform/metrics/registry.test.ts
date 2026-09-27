import { describe, it, expect } from "vitest";
import { METRIC_REGISTRY, UnknownMetricError, InvalidLabelError, validateRecording, isBoundedToken, isStatusClass, isOneOf } from "./registry.js";

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

  it("every metric in the registry is reachable with an all-valid label set (no metric is unrecordable by construction)", () => {
    const sample: Record<string, string> = {
      route: "/servers/:serverId/status",
      status_class: "2xx",
      api: "vanilla",
      query: "servers.lockServerByPublicId",
      server: "abc123",
      group: "status",
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
