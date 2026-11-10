import type { ManagedServerListResponse } from "@satisfactory-dash/shared";
import { managedServersWithAgent } from "@satisfactory-dash/shared/fixtures";

/** The operator's managed list after ADR-0066: agent servers only. */
const [factoryTwo] = managedServersWithAgent.agentServers;

export const managedAgentOne = { agentServers: [factoryTwo] } satisfies ManagedServerListResponse;

export const managedAgentSeveral = {
  agentServers: [factoryTwo, { id: "creative-test", displayName: "Creative test world", kind: "agent" }],
} satisfies ManagedServerListResponse;

export const managedAgentNone = { agentServers: [] } satisfies ManagedServerListResponse;
