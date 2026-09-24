import { useSelectedServer, useServerSwitch } from "./ServerContext";

/** The selected game server, and "Change server" when there's more than one. Inside ServerGate. */
export function ServerSwitcher() {
  const server = useSelectedServer();
  const { serverCount, change } = useServerSwitch();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <p className="min-w-0 truncate">
        <span className="sr-only">Game server: </span>
        <span className="font-medium text-fg-strong">{server.displayName}</span>
      </p>
      {serverCount > 1 && (
        <button type="button" onClick={change}>
          Change server
        </button>
      )}
    </div>
  );
}
