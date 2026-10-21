import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { useSelectedServer } from "../servers/ServerContext";
import { isSelfServeOwner, pendingServerName } from "./selfServeText";

/**
 * What Settings → Your server has to offer (ADR-0046): "Add your server" while the list says self-serve is on (unless the
 * player still has a server waiting for its first connection: the backend refuses another then, cap C3), and the owner's
 * controls on a server they added. The shell mounts the section only when `visible`: even an empty section would add its
 * wrapper (and a grid gap) to every other user's Settings page.
 */
export function useYourServer(): { canAdd: boolean; isOwner: boolean; pendingName: string | undefined; visible: boolean } {
  const server = useSelectedServer();
  const list = useQuery(queries.servers()).data;
  // The agent status is read on this page anyway; once it says enrolled the list may still be catching up.
  const agentEnrolled = useQuery(queries.agentStatus(server.id)).data?.enrolled;
  const enabled = list?.selfServeEnabled === true;
  const isOwner = isSelfServeOwner(server);
  const pendingName = enabled ? pendingServerName(list?.servers ?? [], { serverId: server.id, enrolled: agentEnrolled }) : undefined;
  return { canAdd: enabled && pendingName === undefined, isOwner, pendingName, visible: enabled || isOwner };
}
