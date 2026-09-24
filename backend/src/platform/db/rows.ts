import { z } from "zod";

/**
 * ADR-0025 decision 2: every row set is parsed by a zod schema, so a typo'd column or a
 * migration that drifted from the code fails loudly at the repository boundary instead of
 * flowing on as `undefined`. The error names the schema's context, never the row (it can hold
 * emails or hashes).
 */
export class RowShapeError extends Error {
  constructor(context: string) {
    super(`Unexpected database row shape in ${context}.`);
    this.name = "RowShapeError";
  }
}

export function parseRows<S extends z.ZodType>(schema: S, rows: unknown[], context: string): z.output<S>[] {
  return rows.map((row) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      throw new RowShapeError(context);
    }
    return parsed.data;
  });
}

/** The first row parsed, or undefined when there is none. */
export function parseFirst<S extends z.ZodType>(schema: S, rows: unknown[], context: string): z.output<S> | undefined {
  return rows.length === 0 ? undefined : parseRows(schema, [rows[0]], context)[0];
}

/** The only row parsed; a missing row is a bug (e.g. an INSERT ... RETURNING that returned nothing). */
export function parseOne<S extends z.ZodType>(schema: S, rows: unknown[], context: string): z.output<S> {
  const row = parseFirst(schema, rows, context);
  if (row === undefined) {
    throw new RowShapeError(context);
  }
  return row;
}
