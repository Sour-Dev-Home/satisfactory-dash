import { describe, it, expect } from "vitest";
import { DatabaseSetupError } from "./errors.js";
import { assertSchemaCurrent } from "./schemaVersion.js";

const fake = (rows: unknown[] | Error) => ({
  calls: [] as unknown[][],
  async query(text: string, values?: unknown[]) {
    this.calls.push([text, values]);
    if (rows instanceof Error) {
      throw rows;
    }
    return { rows };
  },
});

describe("assertSchemaCurrent", () => {
  it("passes when the newest bundled migration is applied, asking with a parameter", async () => {
    const db = fake([{ "?column?": 1 }]);
    await assertSchemaCurrent(db, "1790208000000_schemas");
    expect(db.calls).toEqual([["SELECT 1 FROM pgmigrations WHERE name = $1", ["1790208000000_schemas"]]]);
  });

  it("says to run npm run db:migrate when the newest migration is missing (schema behind)", async () => {
    await expect(assertSchemaCurrent(fake([]), "x")).rejects.toThrow(/behind this build.*npm run db:migrate/);
    await expect(assertSchemaCurrent(fake([]), "x")).rejects.toBeInstanceOf(DatabaseSetupError);
  });

  it("says the same when nothing was ever migrated (undefined_table)", async () => {
    const err = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    await expect(assertSchemaCurrent(fake(err), "x")).rejects.toThrow(/no schema yet.*npm run db:migrate/);
  });

  it("lets other errors through for the startup classifier (e.g. a connection error)", async () => {
    const err = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    await expect(assertSchemaCurrent(fake(err), "x")).rejects.toBe(err);
  });
});
