import type { ManagedServerListResponse } from "@satisfactory-dash/shared";
import { managedServersWithAgent } from "@satisfactory-dash/shared/fixtures";

/**
 * The operator's managed list after ADR-0066: agent servers only. `servers` (stored direct-poll connections) stays in the
 * contract until the contract PR, so these send it empty; the view ignores it either way.
 */
const [factoryTwo] = managedServersWithAgent.agentServers;

export const managedAgentOne = { servers: [], agentServers: [factoryTwo] } satisfies ManagedServerListResponse;

export const managedAgentSeveral = {
  servers: [],
  agentServers: [factoryTwo, { id: "creative-test", displayName: "Creative test world", kind: "agent" }],
} satisfies ManagedServerListResponse;

export const managedAgentNone = { servers: [], agentServers: [] } satisfies ManagedServerListResponse;
