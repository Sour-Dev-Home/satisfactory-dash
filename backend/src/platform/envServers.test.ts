import { describe, expect, it, vi } from "vitest";
import { ENV_SERVERS_NOT_SERVED_MESSAGE, environmentServerEntries, warnEnvServersNotServed } from "./envServers.js";

describe("environmentServerEntries (issue #196)", () => {
  it("with a DATABASE builds nothing: the environment is not a second source of servers, and `build` is not even called", () => {
    const build = vi.fn(() => ["placeholder"]);
    expect(environmentServerEntries(true, build)).toEqual([]);
    expect(build).not.toHaveBeenCalled();
  });

  it("WITHOUT a database (dev, the demo, tests) the environment's servers are used as before", () => {
    const build = vi.fn(() => ["default", "second"]);
    expect(environmentServerEntries(false, build)).toEqual(["default", "second"]);
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe("warnEnvServersNotServed", () => {
  it("warns once with the variable NAMES and the one clear instruction", () => {
    const warn = vi.fn();
    expect(warnEnvServersNotServed({ warn }, ["SATISFACTORY_HOST", "SATISFACTORY_API_TOKEN"])).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ ignored: ["SATISFACTORY_HOST", "SATISFACTORY_API_TOKEN"] }, ENV_SERVERS_NOT_SERVED_MESSAGE);
    expect(ENV_SERVERS_NOT_SERVED_MESSAGE).toBe("servers configured in the environment are not served when a database is used; run npm run admin -- import-servers");
  });

  it("says nothing when no server variable is set", () => {
    const warn = vi.fn();
    expect(warnEnvServersNotServed({ warn }, [])).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs names only: a value handed in by mistake is what the caller gave, and the message carries none", () => {
    const warn = vi.fn();
    warnEnvServersNotServed({ warn }, ["SATISFACTORY_SERVERS_FILE"]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/token|password|=/i);
  });
});
