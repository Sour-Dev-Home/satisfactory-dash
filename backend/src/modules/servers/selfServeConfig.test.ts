import { describe, expect, it } from "vitest";
import { ConfigError } from "../../platform/errors.js";
import { DEFAULT_SELF_SERVE_CONFIG, loadSelfServeConfigFromEnv } from "./selfServeConfig.js";

describe("loadSelfServeConfigFromEnv (ADR-0046 sections 2 and 3)", () => {
  it("defaults to off with the ADR's caps: C1 = 2, C2 = 25, C3 = 1, C5 = 5 a day", () => {
    expect(loadSelfServeConfigFromEnv({})).toEqual({
      enabled: false,
      maxServersPerAccount: 2,
      maxServersTotal: 25,
      maxPendingPerAccount: 1,
      createsPerDay: 5,
    });
    expect(DEFAULT_SELF_SERVE_CONFIG).toEqual(loadSelfServeConfigFromEnv({}));
  });

  it("reads the switch and every cap, trimming blanks", () => {
    const config = loadSelfServeConfigFromEnv({
      SELF_SERVE_ENABLED: " true ",
      SELF_SERVE_MAX_SERVERS_PER_ACCOUNT: "3",
      SELF_SERVE_MAX_SERVERS_TOTAL: "40",
      SELF_SERVE_MAX_PENDING_PER_ACCOUNT: "2",
      SELF_SERVE_CREATES_PER_DAY: "10",
    });
    expect(config).toEqual({ enabled: true, maxServersPerAccount: 3, maxServersTotal: 40, maxPendingPerAccount: 2, createsPerDay: 10 });
    expect(loadSelfServeConfigFromEnv({ SELF_SERVE_ENABLED: "false" }).enabled).toBe(false);
    expect(loadSelfServeConfigFromEnv({ SELF_SERVE_ENABLED: "  " }).enabled).toBe(false);
  });

  it.each(["TRUE", "1", "yes", "on", "tru"])("refuses SELF_SERVE_ENABLED=%s, naming the variable, not the value", (value) => {
    expect(() => loadSelfServeConfigFromEnv({ SELF_SERVE_ENABLED: value })).toThrow(ConfigError);
    expect(() => loadSelfServeConfigFromEnv({ SELF_SERVE_ENABLED: value })).toThrow(/^SELF_SERVE_ENABLED must be "true" or "false"/);
  });

  it.each([
    ["SELF_SERVE_MAX_SERVERS_PER_ACCOUNT", ["0", "21", "-1", "2.5", "two", "1e1"]],
    ["SELF_SERVE_MAX_SERVERS_TOTAL", ["0", "1001", "25x"]],
    ["SELF_SERVE_MAX_PENDING_PER_ACCOUNT", ["0", "21"]],
    ["SELF_SERVE_CREATES_PER_DAY", ["0", "101", " 5 5 "]],
  ])("refuses an out-of-bounds or malformed %s", (name, values) => {
    for (const value of values) {
      expect(() => loadSelfServeConfigFromEnv({ [name]: value })).toThrow(new RegExp(`^${name} must be a whole number`));
    }
  });

  it("accepts each bound's edges", () => {
    expect(loadSelfServeConfigFromEnv({ SELF_SERVE_MAX_SERVERS_PER_ACCOUNT: "1" }).maxServersPerAccount).toBe(1);
    expect(loadSelfServeConfigFromEnv({ SELF_SERVE_MAX_SERVERS_PER_ACCOUNT: "20", SELF_SERVE_MAX_SERVERS_TOTAL: "1000" }).maxServersPerAccount).toBe(20);
    expect(loadSelfServeConfigFromEnv({ SELF_SERVE_CREATES_PER_DAY: "100" }).createsPerDay).toBe(100);
  });

  it("refuses caps that contradict each other", () => {
    expect(() => loadSelfServeConfigFromEnv({ SELF_SERVE_MAX_PENDING_PER_ACCOUNT: "3" })).toThrow(/PENDING_PER_ACCOUNT cannot be more/);
    expect(() => loadSelfServeConfigFromEnv({ SELF_SERVE_MAX_SERVERS_PER_ACCOUNT: "5", SELF_SERVE_MAX_SERVERS_TOTAL: "4" })).toThrow(/PER_ACCOUNT cannot be more than SELF_SERVE_MAX_SERVERS_TOTAL/);
  });
});
