import { z } from "zod";
import { ServerIdSchema } from "./ids";

/**
 * ADR-0030 phase 1: the operator adds, edits and removes the game servers this backend connects to
 * directly. Every route here is OPERATOR ONLY (the seeded operator account; an owner or admin
 * membership is not enough), and the game tokens are WRITE-ONLY: a request may carry them, a
 * response never does (only "set" and the last 4 characters).
 */

/** Ids that would collide with a fixed route under /api/servers. */
export const RESERVED_SERVER_IDS = ["test-connection", "managed"] as const;

/** A hostname, an IPv4 address or an IPv6 literal (with or without brackets). No scheme, path, port,
 *  credentials or whitespace: only what is needed to name a machine. */
const HostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9._:\-[\]]+$/, "Enter a hostname or an IP address only (no scheme, port or path)");

const PortSchema = z.number().int().min(1).max(65535);

/** Printable ASCII with no spaces: an opaque token that can never break a request header. The
 *  empty string is rejected (an FRM token that is not needed is omitted, or null on an edit). */
const TokenSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/, "A token is printable characters without spaces");

/**
 * A server's display name is shown to every member of the server and put in alert messages, so it must be PRINTABLE (issue
 * #198): no control character (Unicode Cc: line breaks, NUL, escape), no format character (Cf: the bidirectional overrides
 * and isolates that make text read as something else, zero-width characters, the byte-order mark), no line or paragraph
 * separator (Zl, Zp), and no surrogate, private-use or unassigned code point. Ordinary letters, digits, marks, punctuation,
 * symbols, emoji and plain spaces are fine. Consequence: an emoji built with the zero-width joiner (a Cf) is refused; use the
 * single-character form.
 */
export const NON_PRINTABLE_IN_NAME = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((name) => !NON_PRINTABLE_IN_NAME.test(name), "A name is printable text: no control, invisible or direction-changing characters");

const ConnectionShape = {
  host: HostSchema,
  apiPort: PortSchema,
  frmPort: PortSchema,
  apiToken: TokenSchema,
  frmToken: TokenSchema.optional().describe("Optional: FRM can run without a token."),
};

/** POST /api/servers */
export const CreateServerRequestSchema = z.strictObject({
  id: ServerIdSchema.refine((id) => !(RESERVED_SERVER_IDS as readonly string[]).includes(id), "That id is reserved"),
  displayName: DisplayNameSchema,
  ...ConnectionShape,
});

/** PATCH /api/servers/:serverId: only the fields to change. `frmToken: null` clears the FRM token. */
export const UpdateServerRequestSchema = z
  .strictObject({
    displayName: DisplayNameSchema.optional(),
    host: HostSchema.optional(),
    apiPort: PortSchema.optional(),
    frmPort: PortSchema.optional(),
    apiToken: TokenSchema.optional(),
    frmToken: TokenSchema.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), "Send at least one field to change");

/** POST /api/servers/test-connection: try entered values before saving. */
export const TestConnectionRequestSchema = z.strictObject(ConnectionShape);

const ConnectionCheckSchema = z.object({
  ok: z.boolean(),
  error: z
    .enum(["unreachable", "unauthorized", "invalid_response"])
    .optional()
    .describe("Why the check failed. A plain code, never a message from the game server."),
});

/** The result of a test connection: the vanilla API (QueryServerState) and FRM (getSessionInfo). */
export const TestConnectionResponseSchema = z.object({
  ok: z.boolean().describe("True only when both checks passed."),
  api: ConnectionCheckSchema,
  frm: ConnectionCheckSchema,
});

/** A stored connection as the operator sees it: never a token. */
export const ServerConnectionSchema = z.object({
  id: ServerIdSchema,
  displayName: z.string(),
  host: z.string().describe("What the operator entered."),
  apiPort: z.number().int(),
  frmPort: z.number().int(),
  apiTokenSet: z.literal(true),
  apiTokenLast4: z.string().nullable().describe("Null for a short token or when the stored value cannot be read."),
  frmTokenSet: z.boolean(),
  frmTokenLast4: z.string().nullable(),
  state: z
    .enum(["ok", "unreadable", "refused"])
    .describe(
      "'unreadable': the stored tokens cannot be opened with this backend's key; re-enter both tokens. " +
        "'refused': the stored address is not loopback or private, so the backend does not connect to it; " +
        "edit the host (or remove the server).",
    ),
  plainHttpOverLan: z
    .boolean()
    .describe("True when the address is not loopback: FRM is plain HTTP, so its token crosses the LAN (show a warning)."),
});

export const ServerConnectionResponseSchema = z.object({ server: ServerConnectionSchema });

/**
 * A server reached through an edge agent (ADR-0031), as the operator's managed list shows it. It has NO connection fields:
 * enrolling an agent deletes the stored connection (host, ports, encrypted tokens), so there is nothing to edit but its name.
 */
export const AgentServerSchema = z.object({
  id: ServerIdSchema,
  displayName: z.string(),
  kind: z.literal("agent").describe("How the backend reaches this server: through the player's edge agent, not directly."),
});

/** GET /api/servers/managed: every stored connection, including the ones this backend is not serving
 *  (unreadable or refused), which the members' list (GET /api/servers) cannot show. */
export const ManagedServerListResponseSchema = z.object({
  servers: z.array(ServerConnectionSchema),
  agentServers: z
    .array(AgentServerSchema)
    .optional()
    .describe(
      "The servers reached through an edge agent, which have no stored connection and so are not in `servers`. Listed here so the " +
        "operator can still see and rename them. Optional so an older backend's answer still parses (ADR-0007).",
    ),
});

/** PATCH /api/servers/:serverId/name: renames a server. The only edit an agent server has (its `servers` twin, PATCH
 *  /api/servers/:serverId, needs a stored connection). */
export const RenameServerRequestSchema = z.strictObject({ displayName: DisplayNameSchema });
export const RenameServerResponseSchema = z.object({ server: AgentServerSchema });
export const DeleteServerResponseSchema = z.object({ deleted: z.literal(true) });

export type CreateServerRequest = z.infer<typeof CreateServerRequestSchema>;
export type UpdateServerRequest = z.infer<typeof UpdateServerRequestSchema>;
export type TestConnectionRequest = z.infer<typeof TestConnectionRequestSchema>;
export type TestConnectionResponse = z.infer<typeof TestConnectionResponseSchema>;
export type ServerConnection = z.infer<typeof ServerConnectionSchema>;
export type ServerConnectionResponse = z.infer<typeof ServerConnectionResponseSchema>;
export type ManagedServerListResponse = z.infer<typeof ManagedServerListResponseSchema>;
export type DeleteServerResponse = z.infer<typeof DeleteServerResponseSchema>;
export type AgentServer = z.infer<typeof AgentServerSchema>;
export type RenameServerRequest = z.infer<typeof RenameServerRequestSchema>;
export type RenameServerResponse = z.infer<typeof RenameServerResponseSchema>;
