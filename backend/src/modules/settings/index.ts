/**
 * The settings module's public API (ADR-0014): the dashboard's one write to the game
 * server, the auto-pause toggle (ADR-0012). It depends on the gameserver module's
 * allowlisted ServerOptionsPort, never on GetServerOptions output.
 */
import type { Router } from "express";
import type { ServerDirectory } from "../servers/index.js";
import type { ServerOptionsPort } from "../gameserver/index.js";
import { ApiFailure, NotEditableError } from "../../platform/errorResponse.js";
import { createSettingsRouter } from "./routes/settings.js";
import { SettingsService } from "./services/settingsService.js";
import type { SettingsScope, SettingsServices } from "./settingsServices.js";

export type { SettingsScope, SettingsServices } from "./settingsServices.js";

/** ADR-0001: one settings service per registered game server. */
export function createSettingsServices(options: ServerOptionsPort): SettingsServices {
  return new SettingsService(options);
}

/**
 * ADR-0031 PR 5a: the settings of a server reached through an edge agent. The setting lives on the player's game server
 * and the only way to it is a command the agent runs (PR 5b), so until then it can neither be read nor changed: a read
 * says the server's data is not available here (upstream_unreachable), and a change is `not_editable`.
 */
export function createAgentSettingsServices(): SettingsServices {
  return {
    getSettings: () => Promise.reject(new ApiFailure("upstream_unreachable", "This server's settings are not available through its agent yet")),
    setAutoPause: () => Promise.reject(new NotEditableError()),
  };
}

/** GET /settings and PUT /settings/auto-pause, scoped to :serverId through the directory. */
export function createSettingsRouters(directory: ServerDirectory<SettingsScope>): Router[] {
  return [createSettingsRouter(directory)];
}
