import { HealthResponseSchema } from "./health";
import { ServerListResponseSchema } from "./servers";
import { StatusResponseSchema } from "./status";
import { FactoryResponseSchema } from "./factory";
import { PowerResponseSchema } from "./power";

const scoped = (resource: string) => (serverId: string) =>
  `/api/servers/${encodeURIComponent(serverId)}/${resource}`;

/**
 * One entry per endpoint: the Express route pattern, a path builder for clients, and
 * the response schema both sides validate against (ADR-0002). The backend doesn't serve
 * the server-scoped routes until the routes change (ADR-0001); until then only
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
} as const;
