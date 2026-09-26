import type {
  AgentCommand,
  AgentStatusResponse,
  Command,
  CommandResultRequest,
  EnrollRequest,
  EnrollResponse,
  SetAutoPauseResponse,
  SnapshotRequest,
  SnapshotResponse,
} from "../src/index";
import { factoryMixed } from "./factory";
import { playersAvailable } from "./players";
import { powerOk } from "./power";
import { settingsEditable } from "./settings";
import { statusRunning } from "./status";

/** ADR-0031 PR 3: invented values for the edge agent's protocol. The secret and the codes below are made up. */

const cadence = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

/** POST /agent/v1/enroll: the code from the owner and the agent's own version, nothing about the machine. */
export const agentEnrollRequest = { code: "AB3D-7XQ2", agentVersion: "0.1.0" } satisfies EnrollRequest;
/** 201. The secret is base64url, 43 characters (256 bits), shown once. */
export const agentEnrollResponse = {
  agentSecret: "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo",
  serverId: "default",
  cadence,
} satisfies EnrollResponse;

/** POST /agent/v1/snapshots with every part: the parts are the SAME shapes the live routes return (their `data`). */
export const agentSnapshotRequestFull = {
  agentVersion: "0.1.0",
  observedAt: "2026-09-26T12:00:00.000+02:00",
  reachable: true,
  paused: false,
  status: statusRunning.data,
  power: powerOk.data,
  factory: factoryMixed.data,
  players: playersAvailable,
} satisfies SnapshotRequest;

/** Only some parts (the agent samples each source on its own cadence, so a snapshot need not carry all four). */
export const agentSnapshotRequestPartial = {
  agentVersion: "0.1.0",
  observedAt: "2026-09-26T12:00:05.000Z",
  reachable: true,
  paused: false,
  status: statusRunning.data,
  power: powerOk.data,
} satisfies SnapshotRequest;

/** The game (or FRM) could not be reached: `reachable: false`, `paused` unknown, and no parts. */
export const agentSnapshotRequestUnreachable = {
  agentVersion: "0.1.0",
  observedAt: "2026-09-26T12:01:00.000Z",
  reachable: false,
  paused: null,
} satisfies SnapshotRequest;

/** 200: the current cadence (the backend can change it in any answer) and whether a command is waiting. */
export const agentSnapshotResponse = { cadence, commandsPending: false } satisfies SnapshotResponse;
export const agentSnapshotResponseCommandWaiting = { cadence: { ...cadence, factorySeconds: 60 }, commandsPending: true } satisfies SnapshotResponse;

const setAutoPause = {
  id: "cmd_01J8Z3K4M5N6P7Q8R9S0T1V2W3",
  type: "set_auto_pause",
  params: { enabled: false },
  expiresAt: "2026-09-26T12:10:00.000Z",
} satisfies AgentCommand;

/** GET /agent/v1/commands: a command this agent knows, and one from a NEWER backend that it must report `unsupported`. */
export const agentCommandsList = {
  commands: [
    setAutoPause,
    { id: "cmd_01J8Z3K4M5N6P7Q8R9S0T1V2W4", type: "restart_frm", params: { graceSeconds: 30 }, expiresAt: "2026-09-26T12:10:00.000Z" },
  ],
};
/** The long-poll timed out with nothing to do. */
export const agentCommandsEmpty = { commands: [] as AgentCommand[] };

/** POST /agent/v1/commands/:commandId/result: codes only, no free text. */
export const agentResultRequestOk = { ok: true } satisfies CommandResultRequest;
export const agentResultRequestFailed = { ok: false, code: "upstream_unreachable" } satisfies CommandResultRequest;
export const agentResultRequestUnsupported = { ok: false, code: "unsupported" } satisfies CommandResultRequest;
export const agentResultResponse = { accepted: true } as const;

/** POST /api/servers/:serverId/agent/enrollment-codes (201): valid 10 minutes, single use. */
export const agentEnrollmentCodeResponse = { code: "AB3D-7XQ2", expiresAt: "2026-09-26T12:10:00.000Z" };

/** GET /api/servers/:serverId/agent */
export const agentStatusEnrolled = {
  enrolled: true,
  lastSeenAt: "2026-09-26T12:00:05.000Z",
  agentVersion: "0.1.0",
  connectionKind: "agent",
} satisfies AgentStatusResponse;
export const agentStatusNotEnrolled = {
  enrolled: false,
  lastSeenAt: null,
  agentVersion: null,
  connectionKind: "local",
} satisfies AgentStatusResponse;
/** Enrolled but never heard from yet. */
export const agentStatusEnrolledSilent = { enrolled: true, lastSeenAt: null, agentVersion: null, connectionKind: "agent" } satisfies AgentStatusResponse;
/** DELETE /api/servers/:serverId/agent */
export const agentRevokeResponse = { revoked: true } as const;

const commandBase = { id: setAutoPause.id, type: "set_auto_pause", createdAt: "2026-09-26T12:00:00.000Z", expiresAt: "2026-09-26T12:10:00.000Z" };
const commandOf = (status: string, completedAt: string | null, resultCode: string | null): { command: Command } => ({
  command: { ...commandBase, status, completedAt, resultCode },
});

/** GET /api/servers/:serverId/commands/:commandId, one per status. */
export const commandPending = commandOf("pending", null, null);
export const commandSent = commandOf("sent", null, null);
export const commandSucceeded = commandOf("succeeded", "2026-09-26T12:00:07.000Z", null);
export const commandFailed = commandOf("failed", "2026-09-26T12:00:07.000Z", "upstream_unreachable");
export const commandExpired = commandOf("expired", "2026-09-26T12:10:00.000Z", null);

/** The auto-pause PUT's two answers: today's 200 with the setting, and the additive 202 with the command to poll. */
export const autoPauseResponseSetting = settingsEditable satisfies SetAutoPauseResponse;
export const autoPauseResponseAccepted = commandPending satisfies SetAutoPauseResponse;
