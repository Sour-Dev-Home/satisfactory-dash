import { CopyButton } from "../components/CopyButton";

/** The message the owner pastes into their server's Discord (#530): what the dashboard shows of the players, and that it isn't kept. */
export const PLAYER_NOTICE =
  "This server is connected to Satisfactory Dash, a dashboard for the factory. Its members can see the in-game names of players who are online. Names are shown live and are not stored.";

/**
 * A ready-made message for the server's players. Only the edge agent reports player names; the mod sends
 * player counts, so the message is optional for a server that connects with the mod alone. Telling the
 * players is the owner's job.
 */
export function PlayerNotice() {
  return (
    <section aria-labelledby="player-notice-heading" className="mt-2 grid gap-2">
      <h4 id="player-notice-heading" className="mb-0 text-sm font-semibold text-fg-strong">
        Tell your players
      </h4>
      <p className="mb-0">
        If you connect with the edge agent, your server&apos;s members can see who is online. Paste this into your
        server&apos;s Discord so your players know. The mod sends player counts only, so with the mod alone the message is
        optional.
      </p>
      <div className="flex items-start gap-2 rounded-card border border-line bg-surface p-3">
        <p className="mb-0 flex-1 text-muted">{PLAYER_NOTICE}</p>
        <CopyButton text={PLAYER_NOTICE} label="Copy the message for your players" />
      </div>
    </section>
  );
}
