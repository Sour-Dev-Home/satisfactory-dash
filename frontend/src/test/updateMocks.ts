import { agentStatusEnrolled, compatResponse } from "@satisfactory-dash/shared/fixtures";

// ADR-0057 Decision 7 mocks for the update banners, shared by the unit handlers and the scenarios.

/**
 * The default policy: nothing newer than the fixtures' own agent (0.1.0), so every existing state stays quiet. The
 * banner states below bring their own policy.
 */
export const compatQuiet = {
  mod: { current: "1.2.0", minSupported: "1.0.0", minSafe: "1.0.0", advisories: [] },
  agent: { current: "0.1.0", minSupported: "0.1.0", minSafe: "0.1.0", advisories: [] },
};

/** A reporting agent / mod at a given version. The mod says `mod/x.y.z`, the agent a bare version. */
export const reporting = (agentVersion: string) => ({ ...agentStatusEnrolled, agentVersion });

/** The shared fixture's policy: agent 0.4.0 (supported from 0.2.0, safe from 0.3.0), mod 1.2.0 with an advisory on 1.0.x. */
export const compatPolicy = compatResponse;
