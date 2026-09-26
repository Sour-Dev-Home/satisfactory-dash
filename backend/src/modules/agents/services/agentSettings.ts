import type { Command, Settings } from "@satisfactory-dash/shared";
import type { CommandsService } from "./commandsService.js";

/**
 * ADR-0031 PR 5b: the settings service of a server reached through an edge agent. The setting lives on the player's game
 * server and the only way to it is a command the agent runs, so:
 *  - reading it reports the last value the agent confirmed (or the one being applied), `pending` while a change waits,
 *    and `editable` while an agent is enrolled; before any change was confirmed it is unknown (upstream_unreachable),
 *    because the agent's snapshot has no auto-pause field;
 *  - changing it creates a command and returns it (the route answers 202); the client follows the command until it is
 *    done or expired. Nothing is written to a game server from here.
 *
 * It has the shape of the settings module's `SettingsServices`, written out here so the two modules do not depend on each
 * other: the composition root puts it in the server's directory entry.
 */
export interface AgentSettingsServices {
  getSettings(): Promise<Settings>;
  setAutoPause(
    enabled: boolean,
    onApplied: (change: { from: boolean; to: boolean; confirmedByReread?: boolean }) => void,
    context?: { actorUserId?: string },
  ): Promise<{ command: Command }>;
}

/** The service for the server with this public id. */
export function createAgentSettingsServices(commands: Pick<CommandsService, "readAutoPause" | "requestAutoPause">, serverId: string): AgentSettingsServices {
  return {
    getSettings: () => commands.readAutoPause(serverId),
    // `onApplied` is the local write's audit hook: nothing is applied here, and the command's own audit event says who asked.
    setAutoPause: async (enabled, _onApplied, context) => ({ command: await commands.requestAutoPause(serverId, enabled, context?.actorUserId) }),
  };
}
