import { agentEnrollResponse } from "./agent";

/** ADR-0051 section 1 / ADR-0057: invented values for device-code pairing and the compat block. The secret is made up. */

/** POST /agent/v1/pairings (agent -> backend). */
export const pairingStartRequest = { agentVersion: "0.1.0", serverName: "Factory Island" };
/** 201. The secret is base64url, 22 characters (128 bits). */
export const pairingStartResponse = { pairingSecret: "c2VjcmV0LXBhaXJpbmctMT", userCode: "AB3D-7XQ2-K5MN", expiresIn: 900, interval: 5 };
/** POST /agent/v1/pairings/poll: the secret goes in the body. */
export const pairingPollRequest = { pairingSecret: pairingStartResponse.pairingSecret };
export const pairingPollResponsePending = { status: "pending" };
export const pairingPollResponseExpired = { status: "expired" };
export const pairingPollResponseSlowDown = { status: "slow_down" };
/** 201: enrol's shape plus the status tag. */
export const pairingPollResponseApproved = { status: "approved", ...agentEnrollResponse };

/** POST /api/pairings/lookup and /approve (signed-in user). */
export const pairingLookupRequest = { userCode: "AB3D-7XQ2-K5MN" };
export const pairingLookupResponse = { serverName: "Factory Island", agentVersion: "0.1.0", requestedAt: "2026-10-25T12:00:00.000Z" };
export const pairingApproveRequestNew = { userCode: "AB3D-7XQ2-K5MN", target: { kind: "new" } };
export const pairingApproveRequestExisting = { userCode: "AB3D-7XQ2-K5MN", target: { kind: "existing", serverId: "default" } };
export const pairingApproveResponse = { serverId: "default" };

/** GET /api/compat. */
export const compatResponse = {
  mod: {
    current: "1.2.0",
    minSupported: "1.0.0",
    minSafe: "1.1.0",
    advisories: [{ id: "SD-2026-001", affected: ">=1.0.0 <1.1.0", fixed: "1.1.0", summary: "An example advisory for the tests." }],
  },
  agent: { current: "0.4.0", minSupported: "0.2.0", minSafe: "0.3.0", advisories: [] },
};
