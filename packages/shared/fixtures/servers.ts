import type { ServerListResponse } from "../src/index";

/** Single-server mode: a registry of one (ADR-0001). */
export const serversSingle = {
  servers: [{ id: "default", displayName: "Satisfactory server" }],
} satisfies ServerListResponse;

export const serversNone = { servers: [] } satisfies ServerListResponse;

/** More than one registered server (ADR-0001): the frontend must offer a choice
 *  instead of auto-selecting. Ids are opaque; display names never contain a host. */
export const serversMultiple = {
  servers: [
    { id: "default", displayName: "Satisfactory server" },
    { id: "creative-test", displayName: "Creative test world" },
    { id: "friends-2", displayName: "Friends' save" },
  ],
} satisfies ServerListResponse;
