import { describe, it, expect } from "vitest";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import type { ServerServices } from "./serverDirectory.js";

const services = (): ServerServices => ({
  status: { getStatus: async () => ({}) as never },
  production: { getFactoryOverview: async () => ({}) as never },
  power: { getPowerOverview: async () => ({}) as never },
});

describe("InMemoryServerDirectory", () => {
  it("lists only id and display name, never anything else about the server", () => {
    const withExtras = { id: "default", displayName: "Home", services: services(), host: "10.0.0.5" };
    const directory = new InMemoryServerDirectory([withExtras]);
    expect(directory.list()).toEqual([{ id: "default", displayName: "Home" }]);
  });

  it("returns a server's services by id, and undefined for an unknown id", () => {
    const home = services();
    const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: home }]);
    expect(directory.get("default")).toBe(home);
    expect(directory.get("other")).toBeUndefined();
  });

  it("refuses two servers with the same id", () => {
    const entry = { id: "default", displayName: "Home", services: services() };
    expect(() => new InMemoryServerDirectory([entry, { ...entry }])).toThrow(/Duplicate server id/);
  });
});
