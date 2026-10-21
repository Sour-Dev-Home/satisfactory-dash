import type { ApiErrorResponse, DeleteAccountResponse, LeaveServerResponse } from "@satisfactory-dash/shared";

// ADR-0047 mocks for deleting your account and leaving a server (#311 task 3), shared by the unit handlers and the
// scenarios. The shared fixtures have no envelopes for these codes yet, so they are typed against the contract here,
// with the backend's own messages (identity/routes/account.ts, servers/membersRouter.ts).

/** DELETE /api/account succeeded: the session is gone with the account. */
export const accountDeleted = { deleted: true } satisfies DeleteAccountResponse;

/** POST /api/servers/:serverId/members/me/leave succeeded. */
export const serverLeft = { left: true } satisfies LeaveServerResponse;

/** 403: the session's sign-in is older than 10 minutes. */
export const errorReauthRequired = {
  error: { code: "reauth_required", message: "Sign in again to delete your account.", requestId: "00000000-0000-4000-8000-000000000561" },
} satisfies ApiErrorResponse;

/** 409: the account owns servers the operator set up, listed in `servers`. */
export const errorOperatorServers = {
  error: {
    code: "would_orphan",
    reason: "operator_servers",
    message: "You own servers the operator set up. They need a new owner before your account can be deleted: contact the operator.",
    requestId: "00000000-0000-4000-8000-000000000562",
    servers: [
      { id: "default", displayName: "Satisfactory server" },
      { id: "creative-test", displayName: "Creative test world" },
    ],
  },
} satisfies ApiErrorResponse;

/** 403: the operator's own account is never deleted here. */
export const errorOperatorAccount = {
  error: {
    code: "forbidden",
    reason: "operator_account",
    message: "The operator's account can't be deleted.",
    requestId: "00000000-0000-4000-8000-000000000563",
  },
} satisfies ApiErrorResponse;

/** 409: the owner tried to leave their own server. */
export const errorLastOwner = {
  error: {
    code: "would_orphan",
    reason: "last_owner",
    message: "You own this server. Remove it from Satisfactory Dash instead of leaving it.",
    requestId: "00000000-0000-4000-8000-000000000564",
  },
} satisfies ApiErrorResponse;
