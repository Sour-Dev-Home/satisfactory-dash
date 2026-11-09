import { describe, expect, it } from "vitest";
import { PairingPollResponseSchema } from "@satisfactory-dash/shared";
import { pairingPollResponseApproved } from "@satisfactory-dash/shared/fixtures";
import { generateDisplayName } from "../../identity/generatedName.js";
import { shareableApprover } from "./pairingService.js";

describe("shareableApprover: only identity's generated names reach a game server", () => {
  it("passes what identity generates, short and widened", async () => {
    for (let i = 0; i < 50; i++) {
      const short = await generateDisplayName(async () => false);
      expect(shareableApprover(short)).toBe(short);
      // Every short candidate taken: the 8-character form.
      const long = await generateDisplayName(async (name) => name.length === "Player-".length + 4);
      expect(long).toHaveLength("Player-".length + 8);
      expect(shareableApprover(long)).toBe(long);
    }
  });

  it("drops anything else: a chosen name, letters outside the alphabet, other lengths, case, padding", () => {
    for (const name of [
      undefined,
      "",
      "operator",
      "Alice Smith",
      "player-4F2K",
      "Player-4f2k",
      "Player-4F2",
      "Player-4F2K9",
      "Player-4F2K9QXZA",
      "Player-IO01",
      "Player-4L2K",
      "Player-4F2K ",
      " Player-4F2K",
      "Player-4F2K\n",
      "Player-",
    ]) {
      expect(shareableApprover(name), JSON.stringify(name)).toBeUndefined();
    }
  });

  it("whatever passes also passes the contract", () => {
    for (const name of ["Player-4F2K", "Player-4F2K9QXZ"]) {
      expect(PairingPollResponseSchema.safeParse({ ...pairingPollResponseApproved, approvedBy: shareableApprover(name) }).success).toBe(true);
    }
  });
});
