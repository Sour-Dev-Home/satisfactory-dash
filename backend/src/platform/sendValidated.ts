import type { Response } from "express";
import type { z } from "zod";

/** A response failed its contract schema: always our own mapping bug, never bad
 *  upstream data (that must fail earlier, in the adapter). Mapped to 500 internal. */
export class ContractViolationError extends Error {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super(`Response failed contract validation: ${issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    this.name = "ContractViolationError";
  }
}

/**
 * ADR-0002: every response goes through its packages/shared schema in every
 * environment, and the PARSED output is what's sent. Unknown keys are stripped, so a
 * field a service adds by accident can't leak to the public frontend.
 */
export function sendValidated<S extends z.ZodType>(res: Response, schema: S, body: z.input<S>): void {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ContractViolationError(result.error.issues);
  }
  res.json(result.data);
}
