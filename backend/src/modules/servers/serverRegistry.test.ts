import { describe, it, expect } from "vitest";
import { ServerIdSchema } from "@satisfactory-dash/shared";
import { ConfigError } from "../../platform/errors.js";
import { SERVER_ID_PATTERN, loadServerRegistryFromEnv } from "./serverRegistry.js";

// ADR-0001: single-server mode is a registry of one.
describe("loadServerRegistryFromEnv", () => {
  it("refuses the ids that are fixed API routes (ADR-0030), naming the id and never the environment", () => {
    for (const id of ["managed", "test-connection"]) {
      expect(() => loadServerRegistryFromEnv({ SATISFACTORY_SERVER_ID: id })).toThrow(/reserved/);
    }
    expect(loadServerRegistryFromEnv({ SATISFACTORY_SERVER_ID: "managed-2" })[0]?.id).toBe("managed-2");
  });

  it("defaults to one server with id \"default\"", () => {
    const [entry, ...rest] = loadServerRegistryFromEnv({});
    expect(rest).toEqual([]);
    expect(entry).toEqual({ id: "default", displayName: "Satisfactory server" });
  });

  it("reads the id and display name from the environment", () => {
    const [entry] = loadServerRegistryFromEnv({ SATISFACTORY_SERVER_ID: "home-1", SATISFACTORY_SERVER_NAME: "Home base" });
    expect(entry).toMatchObject({ id: "home-1", displayName: "Home base" });
  });

  it("refuses an id that isn't lowercase letters, digits and dashes", () => {
    for (const id of ["Home", "a/b", "x".repeat(33), "host:7777"]) {
      expect(() => loadServerRegistryFromEnv({ SATISFACTORY_SERVER_ID: id })).toThrow(ConfigError);
    }
  });

  it("uses the same server-id rule as the public contract", () => {
    for (const id of ["default", "a", "home-1", "x".repeat(32), "", "Home", "a_b", "x".repeat(33), "a b"]) {
      expect(SERVER_ID_PATTERN.test(id), id).toBe(ServerIdSchema.safeParse(id).success);
    }
  });
});
