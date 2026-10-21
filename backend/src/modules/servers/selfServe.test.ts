import { describe, expect, it } from "vitest";
import { ServerIdSchema, RESERVED_SERVER_IDS } from "@satisfactory-dash/shared";
import { SELF_SERVE_ID_LENGTH, generateServerPublicId } from "./selfServe.js";

describe("generateServerPublicId (ADR-0020: 20 random base32 characters)", () => {
  it("is 20 lowercase base32 characters, a valid public id that is never reserved", () => {
    const ids = Array.from({ length: 200 }, () => generateServerPublicId());
    for (const id of ids) {
      expect(id).toMatch(/^[a-z2-7]{20}$/);
      expect(id).toHaveLength(SELF_SERVE_ID_LENGTH);
      expect(ServerIdSchema.safeParse(id).success).toBe(true);
      expect((RESERVED_SERVER_IDS as readonly string[]).includes(id)).toBe(false);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the whole alphabet (no character is unreachable)", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateServerPublicId()).join(""));
    expect(seen.size).toBe(32);
  });
});
