import { z } from "zod";
import { ServerIdSchema } from "./ids";
import { StatusSchema } from "./status";
import { PowerSchema } from "./power";
import { FactorySchema } from "./factory";
import { ServerPlayersResponseSchema } from "./players";
import { SettingsResponseSchema } from "./settings";

/**
 * ADR-0031 PR 3: the edge agent's protocol and the user-facing side of it (enrolment, agent status, commands). The agent
 * runs beside the game and only ever connects OUT to the backend; the backend never reaches into a player's network.
 *
 * TWO SURFACES
 * - The AGENT API, under `/agent/v1` (NOT under `/api/servers`): authenticated by the agent's own credential
 *   (`Authorization: Bearer <agentSecret>`, except `enroll`, which is authenticated by the one-time code). It is outside
 *   the membership-based tests; the backend's PR 5 has its own auth tests. Any agent auth failure, revoked or unknown, is
 *   the same 401 `unauthorized`.
 * - The USER-facing routes, under `/api/servers/:serverId` (members read, owner/admin write).
 *
 * DEPLOY SKEW: an OLD agent must survive a NEWER backend, so RESPONSE fields that name kinds, types, statuses or codes are
 * plain strings with the known values in `.describe()`. REQUESTS are strict (`z.strictObject`) and use enums.
 *
 * PRIVACY: the agent sends game data and nothing about the machine (no hostname, address, user name or paths); it
 * reports only its own version.
 *
 * LIMITS (enforced by the backend, PR 5; documented here so both sides agree): a snapshot body may be gzip-compressed
 * (`Content-Encoding: gzip`), and its DECOMPRESSED size is capped (default 5 MB), so a compression bomb is refused with
 * 413 `payload_too_large`. `waitSeconds` on the command long-poll is 0 to 25.
 */

export const KNOWN_AGENT_COMMAND_TYPES = ["set_auto_pause"] as const;
export const KNOWN_COMMAND_STATUSES = ["pending", "sent", "succeeded", "failed", "expired"] as const;
export const KNOWN_CONNECTION_KINDS = ["local", "agent"] as const;
/** What an agent may report as the result of a command (codes only, never free text). */
export const AGENT_RESULT_CODES = ["unsupported", "upstream_unreachable", "upstream_auth_rejected", "upstream_error"] as const;

const IsoTimeSchema = z.iso.datetime({ offset: true });
const AgentVersionSchema = z.string().min(1).max(32).describe("The agent's own version, at most 32 characters. The only thing about the machine it sends.");

/** How often the agent samples each source, seconds. The backend sets it and can change it in any response. */
export const CadenceSchema = z.object({
  statusSeconds: z.number().int().min(1).max(3600).describe("Status readings (today 5)"),
  powerSeconds: z.number().int().min(1).max(3600).describe("Power readings (today 5)"),
  factorySeconds: z.number().int().min(1).max(3600).describe("Factory readings (today 30)"),
});

// ---------------------------------------------------------------------------------------------------------------------
// The agent API (/agent/v1)
// ---------------------------------------------------------------------------------------------------------------------

/** A one-time enrolment code as shown to the owner: two groups of four base32 characters, e.g. `AB3D-7XQ2`. */
export const EnrollmentCodeSchema = z.string().regex(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);

/** POST /agent/v1/enroll: exchanges the code for the agent's credential. No machine details are sent. */
export const EnrollRequestSchema = z.strictObject({ code: EnrollmentCodeSchema, agentVersion: AgentVersionSchema });
/** 201. The secret is shown ONCE (base64url, 43 characters = 256 bits) and is never returned again. */
export const EnrollResponseSchema = z.object({
  agentSecret: z.string().min(1).describe("The agent's credential, base64url, 43 characters (256 bits). Shown once."),
  serverId: ServerIdSchema.describe("The public id of the server this agent now reports for"),
  cadence: CadenceSchema,
});

/**
 * POST /agent/v1/snapshots: what the agent read from the game. The four data parts REUSE the schemas the live routes
 * return (their `data`, not the response envelope), so one shape describes a reading everywhere. An unreachable game
 * sends `reachable: false` and NO parts; `paused` is null when it is not known.
 */
export const SnapshotRequestSchema = z
  .strictObject({
    agentVersion: AgentVersionSchema,
    observedAt: IsoTimeSchema.describe("When the agent read the game (its own clock, with an offset)"),
    reachable: z.boolean().describe("false = the game server or FRM could not be reached; no parts follow"),
    paused: z.boolean().nullable().describe("The game's pause state, or null when unknown"),
    status: StatusSchema.optional(),
    power: PowerSchema.optional(),
    factory: FactorySchema.optional(),
    players: ServerPlayersResponseSchema.optional(),
  })
  .refine(
    (snapshot) => snapshot.reachable || (snapshot.status === undefined && snapshot.power === undefined && snapshot.factory === undefined && snapshot.players === undefined),
    "An unreachable game sends no data parts",
  );
/** 200. The backend answers every snapshot with the current cadence and whether a command is waiting. */
export const SnapshotResponseSchema = z.object({
  cadence: CadenceSchema,
  commandsPending: z.boolean().describe("true = call GET /agent/v1/commands now"),
});

/** GET /agent/v1/commands?waitSeconds=0..25: a long-poll. */
export const AgentCommandsQuerySchema = z.object({ waitSeconds: z.coerce.number().int().min(0).max(25).default(0) });

export const AgentCommandSchema = z.object({
  id: z.string().describe("Pass it to the result route"),
  type: z.string().describe("Known: set_auto_pause. An agent that meets an unknown type reports it `unsupported`."),
  params: z.record(z.string(), z.unknown()).describe("Parse with the per-type params schema when `type` is known"),
  expiresAt: IsoTimeSchema.describe("After this the command is dropped and must not be run"),
});
/** `set_auto_pause`'s params. */
export const SetAutoPauseParamsSchema = z.strictObject({ enabled: z.boolean() });
/** 200; `commands` may be empty after the wait. */
export const AgentCommandsResponseSchema = z.object({ commands: z.array(AgentCommandSchema) });

/**
 * POST /agent/v1/commands/:commandId/result. Codes only, no free text (a game server's message could hold a token).
 * A success carries no code.
 */
export const CommandResultRequestSchema = z
  .strictObject({ ok: z.boolean(), code: z.enum(AGENT_RESULT_CODES).optional() })
  .refine((result) => !result.ok || result.code === undefined, "A successful result carries no code");
export const CommandResultResponseSchema = z.object({ accepted: z.literal(true) });

// ---------------------------------------------------------------------------------------------------------------------
// User-facing (/api/servers/:serverId): enrolment, agent status, commands
// ---------------------------------------------------------------------------------------------------------------------

/** POST /agent/enrollment-codes (owner/admin), 201: valid for 10 minutes, single use. */
export const EnrollmentCodeResponseSchema = z.object({ code: EnrollmentCodeSchema, expiresAt: IsoTimeSchema });

/** GET /agent */
export const AgentStatusResponseSchema = z.object({
  enrolled: z.boolean(),
  lastSeenAt: IsoTimeSchema.nullable().describe("The agent's last request, or null when none is enrolled or it never reported"),
  agentVersion: z.string().nullable().describe("The version the agent last reported, or null"),
  connectionKind: z.string().describe("How the backend reaches this server. Known: local, agent"),
});

/** DELETE /agent (owner/admin): the credential stops working at once. */
export const RevokeAgentResponseSchema = z.object({ revoked: z.literal(true) });

/** A command as the user sees it. */
export const CommandSchema = z.object({
  id: z.string(),
  type: z.string().describe("Known: set_auto_pause"),
  status: z.string().describe("Known: pending, sent, succeeded, failed, expired"),
  createdAt: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
  completedAt: IsoTimeSchema.nullable(),
  resultCode: z.string().nullable().describe("The agent's result code when it failed, else null"),
});
/** GET /commands/:commandId */
export const CommandResponseSchema = z.object({ command: CommandSchema });

/**
 * The auto-pause PUT's ADDITIVE 202: for a server reached through an agent the change is a command, so the answer is the
 * command (poll `GET /commands/:commandId`), not the new setting. The backend keeps answering 200 with the setting
 * (`SettingsResponseSchema`) until PR 5; a client handles both.
 */
export const CommandAcceptedResponseSchema = z.object({ command: CommandSchema });
export const SetAutoPauseResponseSchema = z.union([SettingsResponseSchema, CommandAcceptedResponseSchema]);

export const CommandIdSchema = z.string().min(1).max(100).describe("A command's id");

export type Cadence = z.infer<typeof CadenceSchema>;
export type EnrollRequest = z.infer<typeof EnrollRequestSchema>;
export type EnrollResponse = z.infer<typeof EnrollResponseSchema>;
export type SnapshotRequest = z.input<typeof SnapshotRequestSchema>;
export type SnapshotResponse = z.infer<typeof SnapshotResponseSchema>;
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export type CommandResultRequest = z.input<typeof CommandResultRequestSchema>;
export type AgentStatusResponse = z.infer<typeof AgentStatusResponseSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type SetAutoPauseResponse = z.infer<typeof SetAutoPauseResponseSchema>;
