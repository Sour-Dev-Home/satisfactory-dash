/**
 * The agent's halted marker (agent/src/halted.ts): `halted.json` in its data folder while it is stopped for a reason that
 * won't fix itself. The server manager reads it itself, read-only, with the same rule as the agent: only a marker with a
 * known reason and a time counts, and only those two fields (the time cut to 40 characters) are kept. Clearing it is the
 * agent's own `resume` command, never this app.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const HaltedSchema = z.object({
  reason: z.enum(["credential_rejected", "store_unreadable"]),
  at: z.string(),
});

export type AgentHalted = z.infer<typeof HaltedSchema>;

export function readAgentHalted(dataDir: string): AgentHalted | undefined {
  let text: string;
  try {
    text = readFileSync(join(dataDir, "halted.json"), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = HaltedSchema.safeParse(JSON.parse(text));
    return parsed.success ? { reason: parsed.data.reason, at: parsed.data.at.slice(0, 40) } : undefined;
  } catch {
    return undefined;
  }
}
