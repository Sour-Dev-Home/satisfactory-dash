import type { Command, Settings } from "@satisfactory-dash/shared";

/** ADR-0031 PR 5b: what the auto-pause PUT answers for a server reached through an edge agent: the change is a COMMAND the
 *  agent will run, not yet the new setting, so the route answers 202 with it (`SetAutoPauseResponseSchema`). */
export interface AutoPauseAccepted {
  command: Command;
}

/** The settings service for one game server. Narrowed so route tests can supply stubs. A `local` server's answers with
 *  the new setting (200); an agent server's with the accepted command (202). */
export interface SettingsServices {
  getSettings(): Promise<Settings>;
  setAutoPause(
    enabled: boolean,
    onApplied: (change: { from: boolean; to: boolean; confirmedByReread?: boolean }) => void,
    /** Who asked, for the command's audit trail (only an agent server's service uses it). */
    context?: { actorUserId?: string },
  ): Promise<Settings | AutoPauseAccepted>;
}

/** What the settings routes read from a server directory entry (the composition root
 *  bundles it with other modules' services; the servers module never looks inside). */
export interface SettingsScope {
  settings: SettingsServices;
}
