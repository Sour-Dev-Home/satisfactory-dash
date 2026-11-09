import { Link, useNavigate } from "react-router";
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
  pairLink = true,
}: {
  onCreated: (serverId: string) => void;
  first?: boolean;
  heading?: boolean;
  /** False on Settings, whose Satis Manager mod section already links to /app/pair for everyone. */
  pairLink?: boolean;
}) {
  const navigate = useNavigate();
  const add = useAddServer();
  return (
    <div className="grid gap-3">
      {first ? (
        <>
          <h2 className="mb-0">Add your first server</h2>
          <p className="mb-0 text-sm text-muted">
            Name it, get a code, paste it into the mod&apos;s config on the game server. The code works once and lasts {CODE_LIFETIME}.
            A server that is never connected is removed after 24 hours.
          </p>
        </>
      ) : (
        <>
          {heading && <h4 className="mb-0">Add your server</h4>}
          <p className="mb-0 text-sm text-muted">
            Name your Satisfactory server. Next you get an enrolment code (it works once and lasts {CODE_LIFETIME}) to paste into the
            Satis Manager mod&apos;s config on the game server. A server that is never connected is removed after 24 hours.
          </p>
        </>
      )}
      {/* Mod 0.3.0 prints a pairing code on the server console when it has no code in its config and no credential. */}
      {pairLink && (
        <p className="mb-0 text-sm text-muted">
          Have a pairing code from your server&apos;s console? <Link to="/app/pair">Pair it</Link>.
        </p>
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
