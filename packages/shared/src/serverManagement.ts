import { z } from "zod";
import { ServerIdSchema } from "./ids";

/**
 * ADR-0030 phase 1, narrowed by ADR-0066: the operator lists, renames and removes the game servers the mod connects. The
 * direct-poll servers (a stored host, ports and game tokens) and their create, edit, test and "switch back to local" routes
 * are gone (ADR-0066 Decision 8 Step B). The managed list is OPERATOR ONLY (the seeded operator account; an owner or admin
 * membership is not enough).
 */

/** Ids that would collide with a fixed route under /api/servers. An id once reserved stays reserved (ADR-0066). */
export const RESERVED_SERVER_IDS = ["test-connection", "managed", "agent"] as const;

/**
 * A server's display name is shown to every member of the server and put in alert messages, so it must be PRINTABLE (issue
 * #198): no control character (Unicode Cc: line breaks, NUL, escape), no format character (Cf: the bidirectional overrides
 * and isolates that make text read as something else, zero-width characters, the byte-order mark), no line or paragraph
 * separator (Zl, Zp), and no surrogate, private-use or unassigned code point. Ordinary letters, digits, marks, punctuation,
 * symbols, emoji and plain spaces are fine. Consequence: an emoji built with the zero-width joiner (a Cf) is refused; use the
 * single-character form.
 */
export const NON_PRINTABLE_IN_NAME = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;
/** Blank-looking fillers that are not Cc/Cf: Hangul fillers, Braille blank, combining grapheme joiner, Khmer inherent vowels,
 *  Mongolian vowel separator; plus any Zs other than the plain space (no-break, ideographic, en/em: look-alike spacing); plus
 *  a stack of 4+ combining marks (zalgo). */
export const LOOKALIKE_IN_NAME = /[͏ᅟᅠ឴឵᠎⠀ㅤﾠ]|(?! )\p{Zs}|\p{M}{4}/u;
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((name) => Array.from(name).length <= 64, "Enter a name of up to 64 characters")
  .refine((name) => !NON_PRINTABLE_IN_NAME.test(name), "A name is printable text: no control, invisible or direction-changing characters")
  .refine((name) => !LOOKALIKE_IN_NAME.test(name), "A name is printable text: no blank-looking fillers, odd spaces or stacked combining marks");

/**
 * A server reached through an edge agent (ADR-0031), as the operator's managed list shows it. It has NO connection fields:
 * enrolling an agent deletes the stored connection (host, ports, encrypted tokens), so there is nothing to edit but its name.
 */
export const AgentServerSchema = z.object({
  id: ServerIdSchema,
  displayName: z.string(),
  kind: z.literal("agent").describe("How the backend reaches this server: through the player's edge agent, not directly."),
});

/** GET /api/servers/managed: the servers the mod connects, which the operator can rename or remove. */
export const ManagedServerListResponseSchema = z.object({
  agentServers: z
    .array(AgentServerSchema)
    .optional()
    .describe("The servers reached through an edge agent. Optional so an older backend's answer still parses (ADR-0007)."),
});

/** PATCH /api/servers/:serverId/name: renames a server, the only edit a server has. */
export const RenameServerRequestSchema = z.strictObject({ displayName: DisplayNameSchema });
export const RenameServerResponseSchema = z.object({ server: AgentServerSchema });

/**
 * POST /api/servers/agent (ADR-0046, self-serve): any signed-in user creates an agent server of their own and becomes its
 * owner. The body is only the name; the answer is 201 with the new agent server. Errors reuse existing codes:
 * `server_limit_reached` (caps), `rate_limited`, `forbidden` (self-serve switched off).
 */
export const CreateAgentServerRequestSchema = z.strictObject({ displayName: DisplayNameSchema });
export const CreateAgentServerResponseSchema = z.object({ server: AgentServerSchema });
export const DeleteServerResponseSchema = z.object({ deleted: z.literal(true) });

export type ManagedServerListResponse = z.infer<typeof ManagedServerListResponseSchema>;
export type DeleteServerResponse = z.infer<typeof DeleteServerResponseSchema>;
export type AgentServer = z.infer<typeof AgentServerSchema>;
export type CreateAgentServerRequest = z.infer<typeof CreateAgentServerRequestSchema>;
export type CreateAgentServerResponse = z.infer<typeof CreateAgentServerResponseSchema>;
export type RenameServerRequest = z.infer<typeof RenameServerRequestSchema>;
export type RenameServerResponse = z.infer<typeof RenameServerResponseSchema>;
