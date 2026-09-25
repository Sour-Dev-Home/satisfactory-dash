import { describe, it, expect } from "vitest";
import { ServerPlayersResponseSchema, endpoints } from "../src/index";

// ADR-0029: the players contract carries a name and whether the player is online, nothing else.
describe("ServerPlayersResponse (ADR-0029)", () => {
  it("parses a list of players and the unavailable answer", () => {
    expect(ServerPlayersResponseSchema.parse({ available: true, players: [{ name: "Pioneer", online: true }] })).toEqual({
      available: true,
      players: [{ name: "Pioneer", online: true }],
    });
    expect(ServerPlayersResponseSchema.parse({ available: false, players: [] })).toEqual({ available: false, players: [] });
  });

  it("drops anything beyond name and online (no ID, location, health or inventory in the contract)", () => {
    const parsed = ServerPlayersResponseSchema.parse({
      available: true,
      players: [{ name: "Pioneer", online: false, ID: "x", location: { x: 1 }, PlayerHP: 100, Inventory: [] }],
    });
    expect(parsed.players[0]).toEqual({ name: "Pioneer", online: false });
  });

  it("rejects a player without a real boolean online or a string name", () => {
    for (const player of [{ name: "P", online: "true" }, { name: 1, online: true }, { online: true }]) {
      expect(ServerPlayersResponseSchema.safeParse({ available: true, players: [player] }).success).toBe(false);
    }
  });

  it("is a server-scoped GET at /players", () => {
    expect(endpoints.players.method).toBe("GET");
    expect(endpoints.players.path("default")).toBe("/api/servers/default/players");
  });
});
