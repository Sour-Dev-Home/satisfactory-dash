import { DeleteAccountPanel } from "./DeleteAccountPanel";
import { LeaveServerPanel } from "./LeaveServerPanel";

/**
 * Settings → your membership of the selected server and your account (ADR-0047). A fragment: each panel is its own item
 * of the page's grid. The shell keys it by server, so a half-open confirm never follows the user to another server.
 */
export function AccountSettings() {
  return (
    <>
      <LeaveServerPanel />
      <DeleteAccountPanel />
    </>
  );
}
