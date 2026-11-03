import { PlayerNotice } from "./PlayerNotice";
import { CODE_LIFETIME } from "./selfServeText";

/**
 * Plain instructions for a self-serve server's code (ADR-0046, shown in Settings → Game PC agent while
 * the player can make one). Prominent (open) while the server is waiting for its first connection;
 * collapsed once it is enrolled, where it is only a reminder for enrolling again.
 *
 * The mod is the way a player connects (owner, 2026-11-03, ADR-0058). `devAgent` (the operator only, see
 * `offersDevAgent`) adds the Node agent's step and the player-names notice, which only the agent needs.
 */
export function EnrolmentGuide({ enrolled, devAgent = false }: { enrolled: boolean; devAgent?: boolean }) {
  return (
    <details open={!enrolled} className="grid gap-2 text-sm">
      <summary className="cursor-pointer text-base font-semibold text-fg-strong">Connect your game server</summary>
      <ol className="mb-0 mt-2 grid list-decimal gap-1 pl-5">
        <li>Create an enrolment code below. It is 12 characters, works once and lasts {CODE_LIFETIME}.</li>
        <li>
          In the game server&apos;s files, open{" "}
          {/* The mod's config file and key: docs-vault/raw-sources/mod-core-v1-config.md (the mod repo's core v1 spec, line 58).
              No restart: the mod re-reads the file when it changes (ADR-0051 Context, citing the mod's Agent.cpp:51-81). */}
          <code>FactoryGame/Configs/SatisDashAgent.cfg</code>, paste the code as the value of <code>enrollmentCode</code> and
          save the file. The Satis Manager mod picks it up while the server runs, so there is no need to restart it.
        </li>
        {devAgent && <li>For development, with the agent app instead: run the command shown with the code.</li>}
        <li>This page shows the server as enrolled once the mod has connected. If the code expires first, create a new one.</li>
      </ol>
      {devAgent && <PlayerNotice />}
    </details>
  );
}
