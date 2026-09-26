/**
 * The settings module's public API (ADR-0014): the dashboard's one write to the game
 * server, the auto-pause toggle (ADR-0012). It depends on the gameserver module's
 * allowlisted ServerOptionsPort, never on GetServerOptions output.
 */
import type { Router } from "express";
import type { ServerDirectory } from "../servers/index.js";
import type { ServerOptionsPort } from "../gameserver/index.js";
import { createSettingsRouter } from "./routes/settings.js";
import { SettingsService } from "./services/settingsService.js";
import type { SettingsScope, SettingsServices } from "./settingsServices.js";

export type { AutoPauseAccepted, SettingsScope, SettingsServices } from "./settingsServices.js";

/** ADR-0001: one settings service per registered game server. */
export function createSettingsServices(options: ServerOptionsPort): SettingsServices {
  return new SettingsService(options);
}

/** GET /settings and PUT /settings/auto-pause, scoped to :serverId through the directory. */
export function createSettingsRouters(directory: ServerDirectory<SettingsScope>): Router[] {
  return [createSettingsRouter(directory)];
}
