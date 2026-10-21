import { useNavigate } from "react-router";
import { useAddServer } from "../api/selfServeWrites";
import { ServerNameForm } from "./ServerNameForm";
import { CODE_LIFETIME, addServerErrorText } from "./selfServeText";

/**
 * "Add your server" (ADR-0046): a display name, then the new server is selected and the player lands on
 * its agent settings, where the enrolment code is made. Shown only while the server list says
 * `selfServeEnabled`. `onCreated` selects the server (ServerGate owns the selection).
 */
export function AddServer({ onCreated, headingLevel = "h4" }: { onCreated: (serverId: string) => void; headingLevel?: "h2" | "h4" }) {
  const navigate = useNavigate();
  const add = useAddServer();
  const Heading = headingLevel;
  return (
    <div className="grid gap-3">
      <Heading className="mb-0">Add your server</Heading>
      <p className="mb-0 text-sm text-muted">
        Name your Satisfactory server. Next you get an enrolment code (it works once and lasts {CODE_LIFETIME}) to paste into the
        dashboard mod or agent on the game PC. A server that is never connected is removed after 24 hours.
      </p>
      <ServerNameForm
        label="Server name"
        submitLabel="Add server"
        busyLabel="Adding…"
        busy={add.isPending}
        error={add.error}
        errorText={addServerErrorText(add.error)}
        onSubmit={async (displayName) => {
          const answer = await add.mutateAsync(displayName);
          onCreated(answer.server.id);
          void navigate("/app/settings#agent");
        }}
      />
    </div>
  );
}
