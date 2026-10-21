import { CODE_LIFETIME } from "./selfServeText";

/**
 * Plain instructions for a self-serve server's code (ADR-0046, shown in Settings → Game PC agent while
 * the player can make one). Prominent (open) while the server is waiting for its first connection;
 * collapsed once it is enrolled, where it is only a reminder for enrolling again.
 */
export function EnrolmentGuide({ enrolled }: { enrolled: boolean }) {
  return (
    <details open={!enrolled} className="grid gap-2 text-sm">
      <summary className="cursor-pointer text-base font-semibold text-fg-strong">Connect your game server</summary>
      <ol className="mb-0 mt-2 grid list-decimal gap-1 pl-5">
        <li>Create an enrolment code below. It is 12 characters, works once and lasts {CODE_LIFETIME}.</li>
        <li>
          With the dashboard mod: open{" "}
          {/* The mod's config file and key: docs-vault/raw-sources/mod-core-v1-config.md (the mod repo's core v1 spec, line 58). */}
          <code>FactoryGame/Configs/SatisDashAgent.cfg</code> on the game PC, paste the code as the value of{" "}
          <code>enrollmentCode</code> and start the game server.
        </li>
        <li>With the agent app instead: run the command shown with the code.</li>
        <li>This page shows the agent as enrolled once it has connected. If the code expires first, create a new one.</li>
      </ol>
    </details>
  );
}
