import type { ServerListResponse } from "../src/index";

/** Single-server mode: a registry of one (ADR-0001). */
export const serversSingle = {
  servers: [{ id: "default", displayName: "Satisfactory server" }],
} satisfies ServerListResponse;

export const serversNone = { servers: [] } satisfies ServerListResponse;
