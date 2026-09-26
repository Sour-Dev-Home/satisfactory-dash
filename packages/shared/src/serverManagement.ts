import { z } from "zod";
import { ServerIdSchema } from "./ids";

/**
 * ADR-0030 phase 1: the operator adds, edits and removes the game servers this backend connects to
 * directly. Every route here is OPERATOR ONLY (the seeded operator account; an owner or admin
 * membership is not enough), and the game tokens are WRITE-ONLY: a request may carry them, a
 * response never does (only "set" and the last 4 characters).
 */

/** Ids that would collide with a fixed route under /api/servers. */
export const RESERVED_SERVER_IDS = ["test-connection"] as const;

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

const DisplayNameSchema = z.string().trim().min(1).max(64);

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
    .enum(["ok", "unreadable"])
    .describe("'unreadable': the stored tokens cannot be opened with this backend's key; re-enter both tokens."),
  plainHttpOverLan: z
    .boolean()
    .describe("True when the address is not loopback: FRM is plain HTTP, so its token crosses the LAN (show a warning)."),
});

export const ServerConnectionResponseSchema = z.object({ server: ServerConnectionSchema });
export const DeleteServerResponseSchema = z.object({ deleted: z.literal(true) });

export type CreateServerRequest = z.infer<typeof CreateServerRequestSchema>;
export type UpdateServerRequest = z.infer<typeof UpdateServerRequestSchema>;
export type TestConnectionRequest = z.infer<typeof TestConnectionRequestSchema>;
export type TestConnectionResponse = z.infer<typeof TestConnectionResponseSchema>;
export type ServerConnection = z.infer<typeof ServerConnectionSchema>;
export type ServerConnectionResponse = z.infer<typeof ServerConnectionResponseSchema>;
export type DeleteServerResponse = z.infer<typeof DeleteServerResponseSchema>;
