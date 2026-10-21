import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { useSelectedServer } from "../servers/ServerContext";
import { isSelfServeOwner } from "./selfServeText";

/**
 * What Settings → Your server has to offer (ADR-0046): "Add your server" while the list says self-serve is on, and the
 * owner's controls on a server they added. The shell mounts the section only when either is true: even an empty
 * section would add its wrapper (and a grid gap) to every other user's Settings page.
 */
export function useYourServer(): { canAdd: boolean; isOwner: boolean; visible: boolean } {
  const server = useSelectedServer();
  const canAdd = useQuery(queries.servers()).data?.selfServeEnabled === true;
  const isOwner = isSelfServeOwner(server);
  return { canAdd, isOwner, visible: canAdd || isOwner };
}
