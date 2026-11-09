import type { Command, Settings } from "@satisfactory-dash/shared";

/** ADR-0031 PR 5b: what the auto-pause PUT answers: the change is a COMMAND the mod will run, not yet the new setting, so
 *  the route answers 202 with it (`SetAutoPauseResponseSchema`). */
export interface AutoPauseAccepted {
  command: Command;
}

/** The settings service for one game server. Narrowed so route tests can supply stubs. Since ADR-0066 every server is
 *  reached through the mod, so the one implementation is the agents module's `createAgentSettingsServices` (the
 *  composition root puts it in the server's directory entry): a change is always a command (202). */
export interface SettingsServices {
  getSettings(): Promise<Settings>;
  /** `context` names who asked, for the command's audit trail. */
  setAutoPause(enabled: boolean, context?: { actorUserId?: string }): Promise<AutoPauseAccepted>;
}

/** What the settings routes read from a server directory entry (the composition root
 *  bundles it with other modules' services; the servers module never looks inside). */
export interface SettingsScope {
  settings: SettingsServices;
}
