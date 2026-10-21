import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { useSelectedServer, useServerSwitch } from "../servers/ServerContext";
import { AddServer } from "./AddServer";
import { OwnedServerPanel } from "./OwnedServerPanel";
import { isSelfServeOwner } from "./selfServeText";

/**
 * Settings → Your server (ADR-0046): the owner's rename and delete for a server they added, and "Add your
 * server" while self-serve is on. Renders nothing for anyone with neither, so nobody sees a control that
 * would answer 403. The server list is already loaded by ServerGate, so there is nothing to wait for.
 */
export function YourServersSection() {
  const server = useSelectedServer();
  const { select } = useServerSwitch();
  const enabled = useQuery(queries.servers()).data?.selfServeEnabled === true;
  const owner = isSelfServeOwner(server);
  if (!enabled && !owner) return null;
  return (
    <section aria-labelledby="your-servers-heading" className="panel grid gap-4">
      <h3 id="your-servers-heading">{owner ? "Your server" : "Add your server"}</h3>
      {owner && <OwnedServerPanel key={server.id} server={server} />}
      {enabled && <AddServer onCreated={select} />}
    </section>
  );
}
