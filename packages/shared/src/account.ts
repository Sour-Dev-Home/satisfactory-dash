import { z } from "zod";

/**
 * ADR-0047: deleting your own account and leaving a server.
 *
 * DELETE /api/account takes no body. It needs a sign-in within the last 10 minutes (else 403 `reauth_required`: send the
 * user through Google sign-in again, back to Settings). Owned self-serve servers are removed from Satisfactory Dash with
 * the account; an owned operator-created server blocks it (409 `would_orphan`, reason `operator_servers`, the servers in
 * the envelope's `servers`). The operator's own account is refused (403 `forbidden`, reason `operator_account`). On
 * success the session is gone too: treat the user as signed out.
 */
export const DeleteAccountResponseSchema = z.object({ deleted: z.literal(true) });

/**
 * POST /api/servers/:serverId/members/me/leave takes no body, needs no fresh sign-in, and is open to any member (viewers
 * included). It removes the caller's membership and their push opt-in for that server. The owner is refused with 409
 * `would_orphan`, reason `last_owner`: an owner removes the server or (later) transfers it instead.
 */
export const LeaveServerResponseSchema = z.object({ left: z.literal(true) });

/**
 * The stable `reason` sub-codes of the ADR-0047 refusals (the envelope's `reason` stays a plain string, ADR-0007, so a
 * client must still handle a reason it does not know).
 */
export const WouldOrphanReason = z.enum(["last_owner", "operator_servers"]);
export const AccountForbiddenReason = z.enum(["operator_account"]);

export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponseSchema>;
export type LeaveServerResponse = z.infer<typeof LeaveServerResponseSchema>;
export type WouldOrphanReason = z.infer<typeof WouldOrphanReason>;
export type AccountForbiddenReason = z.infer<typeof AccountForbiddenReason>;
