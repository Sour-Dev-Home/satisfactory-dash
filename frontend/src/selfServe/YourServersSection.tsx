import { useSelectedServer, useServerSwitch } from "../servers/ServerContext";
import { AddServer } from "./AddServer";
import { OwnedServerPanel } from "./OwnedServerPanel";
import { useYourServer } from "./useYourServer";

/**
 * Settings → Your server (ADR-0046): the owner's rename and delete for a server they added, and "Add your
 * server" while self-serve is on. The shell mounts it only when `useYourServer().visible`, so nobody sees a
 * control that would answer 403. The server list is already loaded by ServerGate: nothing to wait for.
 */
export function YourServersSection() {
  const server = useSelectedServer();
  const { select } = useServerSwitch();
  const { canAdd, isOwner } = useYourServer();
  if (!canAdd && !isOwner) return null;
  return (
    <section aria-labelledby="your-servers-heading" className="panel grid gap-4">
      <h3 id="your-servers-heading">{isOwner ? "Your server" : "Add your server"}</h3>
      {isOwner && <OwnedServerPanel key={server.id} server={server} />}
      {canAdd && <AddServer onCreated={select} />}
    </section>
  );
}
