import { CODE_LIFETIME } from "./selfServeText";

/**
 * Plain instructions for a self-serve server's code (ADR-0046, shown in Settings → Game PC agent while
 * the player can make one). The mod reads the code from its config file (mod spec: `enrollmentCode`);
 * the agent takes it on its command line, shown with the code itself.
 */
export function EnrolmentGuide() {
  return (
    <div role="group" aria-labelledby="enrolment-guide-heading" className="grid gap-2 text-sm">
      <h4 id="enrolment-guide-heading" className="mb-0">
        Connect your game server
      </h4>
      <ol className="mb-0 grid list-decimal gap-1 pl-5">
        <li>Create an enrolment code below. It is 12 characters, works once and lasts {CODE_LIFETIME}.</li>
        <li>
          With the dashboard mod: open <code>FactoryGame/Configs/SatisDashAgent.cfg</code> on the game PC, paste the code as the
          value of <code>enrollmentCode</code> and start the game server.
        </li>
        <li>With the agent app instead: run the command shown with the code.</li>
        <li>This page shows the agent as enrolled once it has connected. If the code expires first, create a new one.</li>
      </ol>
    </div>
  );
}
