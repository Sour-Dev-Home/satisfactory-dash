import type { AgentCommand, Command } from "@satisfactory-dash/shared";
import { ApiFailure, NotEditableError, RateLimitedError, ServerNotFoundError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import { observed } from "../../../platform/snapshot.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { getAgentStatus, lockServer } from "../repositories/agentRepository.js";
import {
  MAX_OPEN_COMMANDS,
  claimOpenCommands,
  completeCommand,
  countOpenCommands,
  getCommandForServer,
  hasOpenCommands,
  insertCommand,
  recentCommandsOfType,
} from "../repositories/commandRepository.js";
import type { CommandRow } from "../repositories/commandRepository.js";
import { CommandNotifier } from "./commandNotifier.js";

/**
 * ADR-0031 PR 5b: commands to an edge agent. The dashboard cannot reach into a player's network, so a change to the game
 * (today: the auto-pause setting) becomes a COMMAND the agent fetches by long-poll, runs, and reports a result CODE for
 * (never free text: a game server's message could hold a token). A command lives 60 seconds; after that it is expired
 * and must not be run.
 *
 * Two faces, so the routes can be tested with stubs: `CommandsService` for the dashboard's users (ask, look up, read the
 * setting) and `AgentCommandsService` for the agent (poll, report, "is one waiting").
 */
export interface CommandsService {
  /** Asks the agent of this server (public id) to set auto-pause. Not editable when no agent is enrolled. */
  requestAutoPause(serverId: string, enabled: boolean, actorUserId: string | undefined): Promise<Command>;
  /** One command of this server, in the contract's shape. server_not_found is not used: an unknown id is command_not_found. */
  getCommand(serverId: string, commandId: string): Promise<Command>;
  /**
   * What the dashboard shows for the setting of an agent server: the value being applied now, else the newer of the last
   * value the agent confirmed and the agent's latest reading (`reported`, from its snapshots; it carries its own time and
   * staleness), whether a change is waiting, and whether it can be changed (an agent is enrolled). With neither the value
   * is unknown (upstream_unreachable), as for an agent that reports no settings before any change was confirmed.
   */
  readAutoPause(serverId: string, reported?: ReportedAutoPause): Promise<{ autoPause: boolean; pending: boolean; editable: boolean }>;
}

/** An auto-pause value the agent reported in a snapshot; the composition root passes the telemetry store's reading in this shape. */
export interface ReportedAutoPause {
  autoPause: boolean;
  observedAtMs: number;
  stale: boolean;
}

export interface AgentCommandsService {
  /** The open commands of this server, oldest first, waiting up to `waitSeconds` (0 to 25) for one. */
  poll(agent: { serverUuid: string }, waitSeconds: number, signal?: AbortSignal): Promise<AgentCommand[]>;
  /** Records the agent's result. Throws command_not_found (unknown, or another server's) or command_expired. */
  report(agent: { serverUuid: string }, commandId: string, result: { ok: boolean; code?: string }): Promise<void>;
  /** Whether a command is waiting for this server: the snapshot answer's `commandsPending`. Never throws. */
  hasPending(serverUuid: string): Promise<boolean>;
}

export interface CommandsServiceDeps {
  db: Queryable & Parameters<typeof withTransaction>[0];
  notifier: CommandNotifier;
  /** Auto-pause changes per user per minute (default 20): the cap of 5 open commands bounds a server, this bounds a person. */
  limiter?: UserRateLimiter;
  now?: () => number;
}

const SET_AUTO_PAUSE = "set_auto_pause";

export const toCommand = (row: CommandRow): Command => ({
  id: row.id,
  type: row.type,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
  resultCode: row.resultCode,
});

const toAgentCommand = (row: CommandRow): AgentCommand => ({
  id: row.id,
  type: row.type,
  params: row.params,
  expiresAt: row.expiresAt.toISOString(),
});

/** A database outage is a 503, never a 500 or a "not found". */
async function orUnavailable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isDatabaseUnavailable(err)) throw Object.assign(new ServiceUnavailableError(), { cause: err });
    throw err;
  }
}

const enabledOf = (row: CommandRow): boolean | undefined => (typeof row.params.enabled === "boolean" ? row.params.enabled : undefined);

export function createCommandsService(deps: CommandsServiceDeps): CommandsService & AgentCommandsService {
  const { db, notifier } = deps;
  const limiter = deps.limiter ?? new UserRateLimiter({ max: 20, windowMs: 60_000 });

  return {
    requestAutoPause: (serverId, enabled, actorUserId) =>
      orUnavailable(async () => {
        if (actorUserId !== undefined) {
          const wait = limiter.hit(actorUserId);
          if (wait > 0) throw new RateLimitedError(wait, "Too many changes. Try again in a moment.");
        }
        const { row, serverUuid } = await withTransaction(db, async (client) => {
          const server = await lockServer(client, serverId);
          if (server === undefined) throw new ServerNotFoundError();
          // Only an agent server has an agent to ask; a `local` one is written to directly (the settings service).
          const status = await getAgentStatus(client, serverId);
          if (server.connectionKind !== "agent" || status === undefined || !status.enrolled) throw new NotEditableError();
          if ((await countOpenCommands(client, server.id)) >= MAX_OPEN_COMMANDS) {
            throw new RateLimitedError(30, "Too many changes are waiting for this server's agent. Try again in a minute.");
          }
          const created = await insertCommand(client, { serverUuid: server.id, type: SET_AUTO_PAUSE, params: { enabled }, createdBy: actorUserId });
          // Ids and codes only: the target value is not needed to know who asked for what.
          await recordAuditEvent(client, { action: "agent.command.created", actorUserId, serverId: server.id, detail: { type: SET_AUTO_PAUSE, commandId: created.id } });
          return { row: created, serverUuid: server.id };
        });
        notifier.notify(serverUuid); // after the commit: the woken poll must find the row
        return toCommand(row);
      }),

    getCommand: (serverId, commandId) =>
      orUnavailable(async () => {
        const row = await getCommandForServer(db, serverId, commandId);
        if (row === undefined) throw new ApiFailure("command_not_found", "No such command on this server");
        return toCommand(row);
      }),

    readAutoPause: (serverId, reported) =>
      orUnavailable(async () => {
        const status = await getAgentStatus(db, serverId);
        if (status === undefined) throw new ServerNotFoundError();
        const recent = await recentCommandsOfType(db, serverId, SET_AUTO_PAUSE);
        const open = recent.find((row) => row.status === "pending" || row.status === "sent");
        const confirmed = recent.find((row) => row.status === "succeeded");
        const editable = status.enrolled;
        // A change being applied is what the user asked for, so it wins over everything.
        const applying = open !== undefined ? enabledOf(open) : undefined;
        if (applying !== undefined) return { autoPause: applying, pending: true, editable };
        const confirmedValue = confirmed !== undefined ? enabledOf(confirmed) : undefined;
        const confirmedAtMs = confirmed?.completedAt?.getTime();
        // Otherwise the NEWER of the last confirmed change and the agent's latest reading: a reading taken after the change
        // shows an edit made in the game since, and one taken before it is out of date.
        if (reported !== undefined && (confirmedValue === undefined || confirmedAtMs === undefined || reported.observedAtMs >= confirmedAtMs)) {
          // Kept while the game is unreachable, then marked stale by the reading's age.
          return observed({ autoPause: reported.autoPause, pending: open !== undefined, editable }, { observedAt: new Date(reported.observedAtMs).toISOString(), stale: reported.stale });
        }
        if (confirmedValue === undefined) {
          throw new ApiFailure("upstream_unreachable", "This server's auto-pause setting is not known yet: the agent has not reported it or confirmed a change");
        }
        return { autoPause: confirmedValue, pending: open !== undefined, editable };
      }),

    async poll(agent, waitSeconds, signal) {
      const waitMs = Math.max(0, Math.min(25, waitSeconds)) * 1000;
      // Subscribe BEFORE looking, so a command created in between still wakes this poll.
      const subscription = waitMs > 0 ? notifier.subscribe(agent.serverUuid, waitMs, signal) : undefined;
      try {
        const rows = await orUnavailable(() => claimOpenCommands(db, agent.serverUuid));
        if (rows.length > 0 || subscription === undefined || signal?.aborted) return rows.map(toAgentCommand);
        await subscription.wake;
        if (signal?.aborted) return [];
        // Woken by a command, by the deadline, or evicted: whatever is there now is the answer (empty on a timeout).
        return (await orUnavailable(() => claimOpenCommands(db, agent.serverUuid))).map(toAgentCommand);
      } finally {
        subscription?.cancel();
      }
    },

    report: (agent, commandId, result) =>
      orUnavailable(async () => {
        const code = result.ok ? undefined : result.code;
        const outcome = await withTransaction(db, async (client) => {
          const done = await completeCommand(client, { serverUuid: agent.serverUuid, commandId, ok: result.ok, code });
          if (done === "accepted") {
            await recordAuditEvent(client, {
              action: result.ok ? "agent.command.succeeded" : "agent.command.failed",
              serverId: agent.serverUuid,
              detail: { commandId, ...(code !== undefined ? { code } : {}) },
            });
          }
          return done;
        });
        if (outcome === "not_found") throw new ApiFailure("command_not_found", "No such command for this agent");
        if (outcome === "expired") throw new ApiFailure("command_expired", "That command expired before its result arrived");
      }),

    async hasPending(serverUuid) {
      try {
        return await hasOpenCommands(db, serverUuid);
      } catch {
        return false; // a hint on the snapshot answer: the agent's own next poll finds the command anyway
      }
    },
  };
}
