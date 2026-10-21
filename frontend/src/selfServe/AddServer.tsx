import { useNavigate } from "react-router";
import { useAddServer } from "../api/selfServeWrites";
import { ServerNameForm } from "./ServerNameForm";
import { CODE_LIFETIME, addServerErrorText, isLimitRefusal } from "./selfServeText";

/**
 * "Add your server" (ADR-0046): a display name, then the new server is selected and the player lands on
 * its agent settings, where the enrolment code is made. Shown only while the server list says
 * `selfServeEnabled`. `onCreated` selects the server (ServerGate owns the selection).
 *
 * `first`: the screen of a player with no server yet (an h2 and the three steps). Otherwise it sits under
 * Settings' own heading: with `heading` false (the section's h3 already says it) it adds none.
 */
export function AddServer({
  onCreated,
  first = false,
  heading = true,
}: {
  onCreated: (serverId: string) => void;
  first?: boolean;
  heading?: boolean;
}) {
  const navigate = useNavigate();
  const add = useAddServer();
  return (
    <div className="grid gap-3">
      {first ? (
        <>
          <h2 className="mb-0">Add your first server</h2>
          <p className="mb-0 text-sm text-muted">
            Name it, get a code, paste it on the game PC. The code works once and lasts {CODE_LIFETIME}. A server that is never connected is
            removed after 24 hours.
          </p>
        </>
      ) : (
        <>
          {heading && <h4 className="mb-0">Add your server</h4>}
          <p className="mb-0 text-sm text-muted">
            Name your Satisfactory server. Next you get an enrolment code (it works once and lasts {CODE_LIFETIME}) to paste into the
            dashboard mod or agent on the game PC. A server that is never connected is removed after 24 hours.
          </p>
        </>
      )}
      <ServerNameForm
        label="Server name"
        placeholder="e.g. Our factory"
        submitLabel="Add server"
        busyLabel="Adding…"
        primary
        busy={add.isPending}
        error={add.error}
        errorText={addServerErrorText(add.error)}
        limitRefusal={isLimitRefusal(add.error)}
        onSubmit={async (displayName) => {
          const answer = await add.mutateAsync(displayName);
          onCreated(answer.server.id);
          void navigate("/app/settings#agent");
        }}
      />
    </div>
  );
}
