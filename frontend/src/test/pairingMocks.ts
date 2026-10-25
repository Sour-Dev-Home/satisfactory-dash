import { pairingApproveResponse, pairingLookupResponse } from "@satisfactory-dash/shared/fixtures";

// ADR-0051 section 1 mocks for the /pair page, shared by the unit handlers and the scenarios.

/** A code the mocks accept; the shared fixture's own. */
export const PAIR_CODE = "AB3D-7XQ2-K5MN";
/** What POST /api/pairings/lookup answers (200). */
export const lookedUp = pairingLookupResponse;
/** What POST /api/pairings/approve answers (200). */
export const approved = pairingApproveResponse;
/** 404 not_found, the one answer for an unknown, spent or expired code. */
export const errorPairingNotFound = {
  error: { code: "not_found", message: "No such pairing", requestId: "00000000-0000-4000-8000-000000000681" },
};
/** 429 on lookup or approve (the answer carries Retry-After). */
export const errorPairingRateLimited = {
  error: { code: "rate_limited", message: "Too many tries", requestId: "00000000-0000-4000-8000-000000000682" },
};
/** 403: sign-up or creation switched off, or the account's cap. */
export const errorPairingForbidden = {
  error: { code: "forbidden", message: "Forbidden", requestId: "00000000-0000-4000-8000-000000000683" },
};
