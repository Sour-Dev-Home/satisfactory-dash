import { cn } from "../lib/cn";
import { chip, chipButton } from "../ui/chip";
import { StationIcon } from "../ui/StationIcon";
import { useSelectedServer, useServerSwitch } from "./ServerContext";

/**
 * The selected game server, and "Change server" when there's more than one. Inside ServerGate.
 * Both are steel chips like the header's other controls (#444); the name is a readout, not a button.
 */
export function ServerSwitcher() {
  const server = useSelectedServer();
  const { serverCount, change } = useServerSwitch();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <p className={cn(chip, "min-w-0 max-w-full")}>
        <StationIcon kind="server" size={20} />
        <span className="sr-only">Game server: </span>
        <span className="min-w-0 truncate">{server.displayName}</span>
      </p>
      {serverCount > 1 && (
        <button type="button" onClick={change} className={chipButton}>
          Change server
        </button>
      )}
    </div>
  );
}
