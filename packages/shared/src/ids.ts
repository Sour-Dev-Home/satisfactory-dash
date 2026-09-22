import { z } from "zod";

/** ADR-0001: server-scoped routes. The id is opaque and never encodes a host or port. */
export const ServerIdSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,32}$/)
  .describe("Opaque server id from GET /api/servers. Never a host or port.");
