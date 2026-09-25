import { describe, it, expect } from "vitest";
import { PlayersService } from "./playersService.js";
import { UpstreamError } from "../../../platform/errors.js";
import { FrmApiRequestError } from "../../gameserver/index.js";

const serviceFor = (getPlayers: () => Promise<{ name: string; online: boolean }[]>) => new PlayersService({ getPlayers });

// ADR-0029: name and online only; `available: false` when FRM is absent, never an error for that.
describe("PlayersService", () => {
  it("returns the players as name and online, available", async () => {
    const service = serviceFor(async () => [
      { name: "Pioneer", online: true },
      { name: "Sleeper", online: false },
    ]);
    await expect(service.getPlayers()).resolves.toEqual({
      available: true,
      players: [
        { name: "Pioneer", online: true },
        { name: "Sleeper", online: false },
      ],
    });
  });

  it("copies exactly name and online, so a future domain field cannot leak into the response", async () => {
    const service = serviceFor(async () => [{ name: "Pioneer", online: true, id: "Char_1", hp: 100 } as never]);
    const { players } = await service.getPlayers();
    expect(Object.keys(players[0]!).sort()).toEqual(["name", "online"]);
  });

  it("an empty server is available with no players (not the same as unavailable)", async () => {
    await expect(serviceFor(async () => []).getPlayers()).resolves.toEqual({ available: true, players: [] });
  });

  it.each([
    ["FRM unreachable", new FrmApiRequestError("connect failed", undefined, { failureKind: "unreachable" })],
    ["FRM not installed (404)", new FrmApiRequestError("not found", 404)],
    ["FRM refused the token (403)", new FrmApiRequestError("forbidden", 403)],
    ["FRM error status (500)", new FrmApiRequestError("boom", 500)],
    ["any other upstream failure", new UpstreamError("upstream down", { failureKind: "unreachable" })],
  ])("answers available:false with no players when %s", async (_name, err) => {
    await expect(serviceFor(() => Promise.reject(err)).getPlayers()).resolves.toEqual({ available: false, players: [] });
  });

  it("does NOT hide a response FRM sent that fails validation: that is a bug to see (502), not 'not installed'", async () => {
    const invalid = new UpstreamError("getPlayer response failed validation", { failureKind: "invalid_response" });
    await expect(serviceFor(() => Promise.reject(invalid)).getPlayers()).rejects.toBe(invalid);
  });

  it("does not swallow our own bugs", async () => {
    const bug = new TypeError("oops");
    await expect(serviceFor(() => Promise.reject(bug)).getPlayers()).rejects.toBe(bug);
  });
});
