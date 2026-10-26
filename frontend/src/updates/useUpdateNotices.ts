import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { updateNotices, type UpdateNotices } from "./notices";

/**
 * What a server's reported version needs, from its agent status and the version policy (ADR-0057 Decision 7). `null`
 * until both are read, when nothing was reported, and for a version this page cannot read: no placeholder, so the
 * banner row does not move for a server that needs nothing. The dashboard only informs; nothing here updates anything.
 */
export function useUpdateNotices(serverId: string): UpdateNotices | null {
  const agent = useQuery(queries.agentStatus(serverId)).data;
  const compat = useQuery(queries.compat()).data;
  return updateNotices(agent?.agentVersion, compat);
}
