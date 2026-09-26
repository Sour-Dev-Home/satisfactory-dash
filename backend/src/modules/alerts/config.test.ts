import { describe, expect, it } from "vitest";
import { ConfigError } from "../../platform/errors.js";
import { loadAlertDeliveryMode } from "./config.js";

// ADR-0027 decision 5: ALERT_DELIVERY=on|off, default OFF, and a typo stops the backend rather than guessing.
describe("loadAlertDeliveryMode", () => {
  it("is off by default: unset, empty or blank", () => {
    for (const value of [undefined, "", "   "]) expect(loadAlertDeliveryMode({ ALERT_DELIVERY: value })).toBe("off");
    expect(loadAlertDeliveryMode({})).toBe("off");
  });

  it("reads on and off, ignoring case and surrounding space", () => {
    expect(loadAlertDeliveryMode({ ALERT_DELIVERY: "on" })).toBe("on");
    expect(loadAlertDeliveryMode({ ALERT_DELIVERY: " ON " })).toBe("on");
    expect(loadAlertDeliveryMode({ ALERT_DELIVERY: "Off" })).toBe("off");
    expect(loadAlertDeliveryMode({ ALERT_DELIVERY: "off" })).toBe("off");
  });

  it.each(["true", "false", "1", "0", "yes", "no", "enabled", "onn", "of", "on off", "on;", "null"])(
    "refuses %s with a ConfigError that names the variable (never silently on or off)",
    (value) => {
      expect(() => loadAlertDeliveryMode({ ALERT_DELIVERY: value })).toThrow(ConfigError);
      expect(() => loadAlertDeliveryMode({ ALERT_DELIVERY: value })).toThrow(/ALERT_DELIVERY/);
    },
  );

  it("the error never echoes the value", () => {
    try {
      loadAlertDeliveryMode({ ALERT_DELIVERY: "hunter2-secret" });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("hunter2");
    }
  });
});
