import type { SettingsService } from "./services/settingsService.js";

/** The settings service for one game server. Narrowed with Pick so route tests can
 *  supply stubs. */
export type SettingsServices = Pick<SettingsService, "getSettings" | "setAutoPause">;

/** What the settings routes read from a server directory entry (the composition root
 *  bundles it with other modules' services; the servers module never looks inside). */
export interface SettingsScope {
  settings: SettingsServices;
}
