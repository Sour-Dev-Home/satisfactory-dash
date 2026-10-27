import { z } from "zod";
import { ServerIdSchema } from "./ids";
import { StatusSchema } from "./status";
import { GeneratorItemSchema, PowerCircuitSchema, PowerGeneratorSchema } from "./power";
import { FactoryBuildingSchema, ProductionRateSchema } from "./factory";
import { PlayerSchema, ServerPlayersResponseSchema } from "./players";
import { SettingsResponseSchema } from "./settings";
import { MapLiveSchema } from "./map";
import { STORAGE_MAX_CONTAINERS, STORAGE_MAX_ITEMS_PER_CONTAINER, StorageContainerSchema, StorageItemSchema } from "./storage";

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

/** A one-time enrolment code as shown to the owner: three groups of four base32 characters (60 bits, ADR-0046 section 4), e.g. `AB3D-7XQ2-K5MN`. */
export const EnrollmentCodeSchema = z.string().regex(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);

/** POST /agent/v1/enroll: exchanges the code for the agent's credential. No machine details are sent. */
export const EnrollRequestSchema = z.strictObject({ code: EnrollmentCodeSchema, agentVersion: AgentVersionSchema });
/** 201. The secret is shown ONCE (base64url, 43 characters = 256 bits) and is never returned again. */
export const EnrollResponseSchema = z.object({
  agentSecret: z.string().min(1).describe("The agent's credential, base64url, 43 characters (256 bits). Shown once."),
  serverId: ServerIdSchema.describe("The public id of the server this agent now reports for"),
  cadence: CadenceSchema,
});

/**
 * What the agent SENDS for power and factory: the response data schemas with every backend-derived field OMITTED
 * (ADR-0031). Deciding a circuit's `status`, a machine's `state`, the counts and a rate's `unit` are RULES and lookups
 * that stay in the backend, which derives them at ingest, so a rule change never needs an agent update, and a missing
 * derivation is a type error rather than a silent "ok". `isBackedUp` stays: it is a raw fact that needs the machine's
 * output inventory, which only the agent sees. The RESPONSE schemas are unchanged. Parsing strips unknown keys, so
 * an older or misbehaving agent that still sends `status`, `state`, `hasOutage`, `stateCounts`, `backedUpCount` or `unit`
 * has them dropped, never trusted.
 *
 * INPUT BOUNDS (the contract every agent is held to, ADR-0031): strings are at most 200 characters, matching the history
 * tables' CHECKs (an over-long class name would otherwise fail a whole batch insert); arrays are capped well above a real
 * factory (buildings 20,000, extractors 5,000, circuits 1,000, generators 5,000, rates per building 16, players 256); numbers
 * are finite (zod refuses NaN and
 * Infinity) and a reading that cannot be negative is `>= 0` (MW, rates, clock speed; battery percent 0-100). A body that
 * breaks a bound is REFUSED (400), never clamped by the backend: the agent clamps float noise (such as a battery at
 * 100.0000001) before it sends. The response schemas have no such bounds.
 */
export const AGENT_INPUT_MAX_STRING = 200;
export const AGENT_INPUT_MAX_BUILDINGS = 20_000;
/** Extractors (miners, oil and water extractors, resource-well extractors), S4-B: well above a map's resource nodes. */
export const AGENT_INPUT_MAX_EXTRACTORS = 5_000;
export const AGENT_INPUT_MAX_CIRCUITS = 1_000;
/** Generators, S4-B: a megabase runs several hundred; this is well above. */
export const AGENT_INPUT_MAX_GENERATORS = 5_000;
export const AGENT_INPUT_MAX_RATES_PER_BUILDING = 16;
export const AGENT_INPUT_MAX_PLAYERS = 256;
const boundedString = z.string().max(AGENT_INPUT_MAX_STRING);
/** The longest `modVersion` a snapshot sender may report (S4-A). */
export const SENDER_VERSION_MAX = 64;
/** The sender's version (`modVersion`), as a snapshot reports it and the agent status repeats it. */
export const SenderVersionSchema = z.string().min(1).max(SENDER_VERSION_MAX);

export const AgentPowerCircuitSchema = PowerCircuitSchema.omit({ status: true }).extend({
  productionMW: z.number().min(0),
  consumptionMW: z.number().min(0),
  capacityMW: z.number().min(0),
  maxConsumptionMW: z.number().min(0),
  batteryPercent: z.number().min(0).max(100),
});
const AgentGeneratorItemSchema = GeneratorItemSchema.omit({ unit: true }).extend({ className: boundedString, name: boundedString });
export const AgentPowerGeneratorSchema = PowerGeneratorSchema.extend({
  id: boundedString,
  name: boundedString,
  className: boundedString,
  fuel: AgentGeneratorItemSchema.nullable(),
  supplement: AgentGeneratorItemSchema.nullable().optional(),
});
export const AgentPowerSchema = z.object({
  circuits: z.array(AgentPowerCircuitSchema).max(AGENT_INPUT_MAX_CIRCUITS),
  // S4-B: OPTIONAL, the mod sends it; the Node agent is frozen on FRM (ADR-0058 Decision 5).
  generators: z.array(AgentPowerGeneratorSchema).max(AGENT_INPUT_MAX_GENERATORS).optional(),
});
const AgentProductionRateSchema = ProductionRateSchema.omit({ unit: true }).extend({ name: boundedString, className: boundedString });
export const AgentFactoryBuildingSchema = FactoryBuildingSchema.omit({ state: true }).extend({
  id: boundedString,
  name: boundedString,
  className: boundedString,
  recipe: boundedString.nullable(),
  clockSpeedPercent: z.number().min(0).optional(),
  production: z.array(AgentProductionRateSchema).max(AGENT_INPUT_MAX_RATES_PER_BUILDING),
  ingredients: z.array(AgentProductionRateSchema).max(AGENT_INPUT_MAX_RATES_PER_BUILDING).optional(),
});
export const AgentFactorySchema = z.object({
  buildings: z.array(AgentFactoryBuildingSchema).max(AGENT_INPUT_MAX_BUILDINGS),
  // S4-B: the extractors in the same building shape, so their output rates reach the backend. OPTIONAL: the Node agent is
  // frozen on FRM (ADR-0058 Decision 5) and never sends it; the mod does.
  extractors: z
    .array(AgentFactoryBuildingSchema)
    .max(AGENT_INPUT_MAX_EXTRACTORS)
    .optional()
    .describe(
      "Extractors as buildings: `recipe` null, `ingredients` [] or absent, `production` the resource they extract. The " +
        "required flags are the same raw facts as a machine's: `isBackedUp` true only when the output slot is full (a " +
        "miner that stops for a full output), else false; `isPaused` and `isProducing` as read.",
    ),
});
/**
 * Storage contents (S4-B), the agent-input form of `StorageSchema`: bounded strings, at most 2,000 containers and 64 item
 * classes each, and no backend-derived `unit`. At the caps a body would pass the snapshot's byte limit
 * (`SNAPSHOT_MAX_BYTES`, backend config), which binds first; a real save is far below both.
 */
const AgentStorageItemSchema = StorageItemSchema.omit({ unit: true }).extend({ className: boundedString, name: boundedString });
export const AgentStorageSchema = z.object({
  containers: z
    .array(
      StorageContainerSchema.extend({
        id: boundedString,
        name: boundedString,
        className: boundedString,
        items: z.array(AgentStorageItemSchema).max(STORAGE_MAX_ITEMS_PER_CONTAINER),
      }),
    )
    .max(STORAGE_MAX_CONTAINERS),
});
/** Status and players as the live routes return them, with the same string and list bounds. */
export const AgentStatusSchema = StatusSchema.extend({ sessionName: boundedString });
export const AgentPlayersSchema = ServerPlayersResponseSchema.extend({
  players: z.array(PlayerSchema.extend({ name: boundedString })).max(AGENT_INPUT_MAX_PLAYERS),
});

/**
 * POST /agent/v1/snapshots: what the agent read from the game. `status` and `players` REUSE the schemas the live routes
 * return (their `data`, not the response envelope); `power` and `factory` are their agent-input forms above. An
 * unreachable game sends `reachable: false` and NO parts and no `settings`; `paused` is null when it is not known.
 */
export const SnapshotRequestSchema = z
  .strictObject({
    agentVersion: AgentVersionSchema,
    observedAt: IsoTimeSchema.describe("When the agent read the game (its own clock, with an offset)"),
    reachable: z.boolean().describe("false = the game server or FRM could not be reached; no parts follow"),
    paused: z.boolean().nullable().describe("The game's pause state, or null when unknown"),
    // S4-A (R7): the sender's own view of its game connection, for the server "test connection" once the FRM half of it
    // is gone. All three are OPTIONAL so every older sender stays valid. They sit beside `reachable`, not inside
    // `status`, because `status` is absent whenever the game is unreachable, which is exactly when these matter.
    gameReachable: z
      .boolean()
      .optional()
      .describe("true = the sender could read the game this cycle; false = it could not. Absent = an older sender that does not report it"),
    lastGameReadAt: IsoTimeSchema.optional().describe(
      "When the sender last read the game successfully (its own clock, with an offset); may be older than observedAt when " +
        "the game is unreachable. Absent = never read since the sender started, or an older sender",
    ),
    modVersion: SenderVersionSchema.optional().describe(
      "The sender's version, the mod's or the agent's, 1 to 64 characters. Absent = an older sender",
    ),
    settings: z
      .strictObject({
        autoPause: z.boolean().describe("The game's auto-pause setting, read in this snapshot"),
        pending: z
          .boolean()
          .optional()
          .describe(
            "true = the game accepted a change (autoPause already shows the new value) that waits to be applied, e.g. " +
              "it sits in PendingServerOptions. A deferred change reports its command ok, never failed; absent = not pending",
          ),
      })
      .optional()
      .describe("Game settings read in this snapshot; absent when not read, and always absent when the game is unreachable"),
    status: AgentStatusSchema.optional(),
    power: AgentPowerSchema.optional(),
    factory: AgentFactorySchema.optional(),
    players: AgentPlayersSchema.optional(),
    // ADR-0038 M1 (#352): fast-changing positions (train and station), at the snapshot cadence,
    // unlike the slow-changing world layers (rails, resourceNodes), which go through their own
    // ingest route (map.ts) rather than the snapshot.
    mapLive: MapLiveSchema.optional(),
    // S4-B: storage contents. OPTIONAL: the mod sends it; the Node agent is frozen on FRM (ADR-0058 Decision 5).
    storage: AgentStorageSchema.optional(),
  })
  .refine(
    (snapshot) => snapshot.reachable || (snapshot.status === undefined &&
        snapshot.power === undefined &&
        snapshot.factory === undefined &&
        snapshot.players === undefined &&
        snapshot.settings === undefined &&
        snapshot.mapLive === undefined &&
        snapshot.storage === undefined),
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

/**
 * How long an enrolled agent may stay silent before it counts as OFFLINE: the default of the `agent_offline` alert rule and
 * the window of `online` in `AgentStatusResponse`, so the two never disagree about what "offline" means.
 */
export const AGENT_OFFLINE_DEFAULT_SECONDS = 120;

/** GET /agent */
export const AgentStatusResponseSchema = z.object({
  enrolled: z.boolean(),
  online: z
    .boolean()
    .optional()
    .describe(
      "true when the backend received a snapshot from this server's agent within the last 2 minutes (AGENT_OFFLINE_DEFAULT_SECONDS, the " +
        "agent_offline rule's default), from the backend's own memory of the last snapshot, so it is fresher than lastSeenAt (which moves " +
        "at most every 30 s). false when none arrived in that window, including after a backend restart before the agent's next snapshot. " +
        "It uses the DEFAULT window, not a per-server override of the agent_offline rule, so if an owner tunes that rule the badge and the " +
        "alert may differ at the margins. Absent when no agent is enrolled. Optional so a newly deployed frontend still parses an older " +
        "backend's answer (ADR-0007).",
    ),
  lastSeenAt: IsoTimeSchema.nullable().describe("The agent's last request, or null when none is enrolled or it never reported"),
  agentVersion: z.string().nullable().describe("The version the agent last reported, or null"),
  connectionKind: z.string().describe("How the backend reaches this server. Known: local, agent"),
  // #740 follow-up: the latest values of the snapshot's optional `gameReachable`, `lastGameReadAt` and `modVersion`, with the
  // same types and bounds. Each is OPTIONAL: absent when the backend has none (no agent enrolled, an older agent that does not
  // report it, or an older backend), so an older backend's answer still parses.
  gameReachable: z
    .boolean()
    .optional()
    .describe("The agent's latest `gameReachable`: true = it could read the game in its last snapshot. Absent = not reported"),
  lastGameReadAt: IsoTimeSchema.optional().describe(
    "The latest `lastGameReadAt` the agent reported: when it last read the game successfully. Only moves forward. Absent = not reported",
  ),
  modVersion: SenderVersionSchema.optional().describe("The latest `modVersion` the agent reported, 1 to 64 characters. Absent = not reported"),
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
export type EnrollmentCodeResponse = z.infer<typeof EnrollmentCodeResponseSchema>;
export type SnapshotRequest = z.input<typeof SnapshotRequestSchema>;
export type AgentPower = z.infer<typeof AgentPowerSchema>;
export type AgentFactory = z.infer<typeof AgentFactorySchema>;
export type SnapshotResponse = z.infer<typeof SnapshotResponseSchema>;
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export type CommandResultRequest = z.input<typeof CommandResultRequestSchema>;
export type AgentStatusResponse = z.infer<typeof AgentStatusResponseSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type SetAutoPauseResponse = z.infer<typeof SetAutoPauseResponseSchema>;
