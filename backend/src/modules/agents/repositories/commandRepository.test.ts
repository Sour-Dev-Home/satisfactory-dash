import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { completeCommand } from "./commandRepository.js";

describe("completeCommand with an id that is not a uuid", () => {
  it("answers not_found without asking Postgres (a uuid column would reject the text with a 500)", async () => {
    const query = vi.fn(async () => {
      throw new Error('invalid input syntax for type uuid: "nope"');
    });
    const db = { query } as unknown as Queryable;
    await expect(completeCommand(db, { serverUuid: "00000000-0000-4000-8000-000000000001", commandId: "nope", ok: true, code: undefined })).resolves.toBe("not_found");
    expect(query).not.toHaveBeenCalled();
  });
});
