import { HealthResponseSchema } from "./health";
import { ServerListResponseSchema } from "./servers";
import { StatusResponseSchema } from "./status";
import { FactoryResponseSchema } from "./factory";
import { PowerResponseSchema } from "./power";
import { PowerHistoryResponseSchema } from "./powerHistory";
import { LoginRequestSchema, SessionResponseSchema } from "./auth";
import { SetAutoPauseRequestSchema, SettingsResponseSchema } from "./settings";

const scoped = (resource: string) => (serverId: string) =>
  `/api/servers/${encodeURIComponent(serverId)}/${resource}`;

/**
 * One entry per endpoint: the Express route pattern, a path builder for clients, and
 * the response schema both sides validate against (ADR-0002). Entries that take a body
 * also have a `request` schema. The backend doesn't serve the server-scoped, auth or
 * settings routes until those changes land (ADR-0001, 0011, 0012); until then only
 * `health` matches a live route.
 */
export const endpoints = {
  health: { method: "GET", route: "/api/health", path: () => "/api/health", response: HealthResponseSchema },
  servers: { method: "GET", route: "/api/servers", path: () => "/api/servers", response: ServerListResponseSchema },
  status: {
    method: "GET",
    route: "/api/servers/:serverId/status",
    path: scoped("status"),
    response: StatusResponseSchema,
  },
  factory: {
    method: "GET",
    route: "/api/servers/:serverId/factory",
    path: scoped("factory"),
    response: FactoryResponseSchema,
  },
  power: {
    method: "GET",
    route: "/api/servers/:serverId/power",
    path: scoped("power"),
    response: PowerResponseSchema,
  },
  // ADR-0022: the last few minutes of power readings, sampled by the backend.
  powerHistory: {
    method: "GET",
    route: "/api/servers/:serverId/power/history",
    path: (serverId: string) => `${scoped("power")(serverId)}/history`,
    response: PowerHistoryResponseSchema,
  },
  // ADR-0011. Every /api route except health requires the session cookie these set.
  auth: {
    login: {
      method: "POST",
      route: "/api/auth/login",
      path: () => "/api/auth/login",
      request: LoginRequestSchema,
      response: SessionResponseSchema,
    },
    logout: { method: "POST", route: "/api/auth/logout", path: () => "/api/auth/logout", response: SessionResponseSchema },
    session: { method: "GET", route: "/api/auth/session", path: () => "/api/auth/session", response: SessionResponseSchema },
  },
  // ADR-0012.
  settings: {
    get: {
      method: "GET",
      route: "/api/servers/:serverId/settings",
      path: scoped("settings"),
      response: SettingsResponseSchema,
    },
    setAutoPause: {
      method: "PUT",
      route: "/api/servers/:serverId/settings/auto-pause",
      path: scoped("settings/auto-pause"),
      request: SetAutoPauseRequestSchema,
      response: SettingsResponseSchema,
    },
  },
} as const;
