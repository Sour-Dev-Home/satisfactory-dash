import type { ServerListResponse } from "../src/index";

/** Single-server mode: a registry of one (ADR-0001). */
export const serversSingle = {
  servers: [{ id: "default", displayName: "Satisfactory server" }],
} satisfies ServerListResponse;

export const serversNone = { servers: [] } satisfies ServerListResponse;

/** ADR-0027 PR 7b: a signed-in user's role on each server, a UX hint only (the backend enforces it). One fixture per
 *  role the backend uses; the no-database and older-backend path simply omits `role` (see `serversSingle`). */
export const serversRoleOwner = { servers: [{ id: "default", displayName: "Satisfactory server", role: "owner" }] } satisfies ServerListResponse;
export const serversRoleAdmin = { servers: [{ id: "default", displayName: "Satisfactory server", role: "admin" }] } satisfies ServerListResponse;
export const serversRoleViewer = { servers: [{ id: "default", displayName: "Satisfactory server", role: "viewer" }] } satisfies ServerListResponse;
/** Different roles on different servers, and one role this build does not know. */
export const serversRolesMixed = {
  servers: [
    { id: "default", displayName: "Satisfactory server", role: "owner" },
    { id: "creative-test", displayName: "Creative test world", role: "viewer" },
    { id: "friends-2", displayName: "Friends' save", role: "moderator" },
  ],
} satisfies ServerListResponse;

/** ADR-0046: self-serve is on; the user owns one enrolled and one pending self-serve server, and sees an operator server. */
export const serversSelfServe = {
  servers: [
    { id: "default", displayName: "Satisfactory server", role: "viewer", createdVia: "operator", enrolled: true },
    { id: "my-first-world", displayName: "My first world", role: "owner", createdVia: "self_serve", enrolled: true },
    { id: "my-new-world", displayName: "My new world", role: "owner", createdVia: "self_serve", enrolled: false },
  ],
  selfServeEnabled: true,
} satisfies ServerListResponse;

/** More than one registered server (ADR-0001): the frontend must offer a choice
 *  instead of auto-selecting. Ids are opaque; display names never contain a host. */
export const serversMultiple = {
  servers: [
    { id: "default", displayName: "Satisfactory server" },
    { id: "creative-test", displayName: "Creative test world" },
    { id: "friends-2", displayName: "Friends' save" },
  ],
} satisfies ServerListResponse;
