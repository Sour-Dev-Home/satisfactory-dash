/**
 * The settings module's public API (ADR-0014): the auto-pause toggle (ADR-0012). Since ADR-0066 the dashboard never writes
 * to a game server: a change is one command the mod runs, created by the server's `SettingsServices` (the agents module's
 * implementation, put in the directory entry by the composition root, so this module depends on no other).
 */
import type { Router } from "express";
import type { ServerDirectory } from "../servers/index.js";
import { createSettingsRouter } from "./routes/settings.js";
import type { SettingsScope } from "./settingsServices.js";

export type { AutoPauseAccepted, SettingsScope, SettingsServices } from "./settingsServices.js";

/** GET /settings and PUT /settings/auto-pause, scoped to :serverId through the directory. */
export function createSettingsRouters(directory: ServerDirectory<SettingsScope>): Router[] {
  return [createSettingsRouter(directory)];
}
