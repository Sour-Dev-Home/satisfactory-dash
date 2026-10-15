import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useNavigate } from "react-router";
import { queries } from "../api/queries";
import { itemLabels } from "../factory/itemLabels";
import { useSelectedServer, useServerSwitch } from "../servers/ServerContext";
import { paletteGroups, paletteScore, type PaletteCommand } from "./paletteCommands";

/**
 * The command bar's search (#351), the only module that imports cmdk. The shell's CommandBar
 * (`shell/Shell.tsx`: the button, the shortcut and the native <dialog>) loads it lazily on the
 * first open (#387), so cmdk stays out of the entry chunk. cmdk does the input, the list, the
 * matching and the arrow keys. Mounted only while open, so its queries run only then.
 */
export function Palette({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const server = useSelectedServer();
  const { serverCount, change } = useServerSwitch();
  const isOperator = useQuery(queries.servers()).data?.canManageServers === true;
  // The live reads the Overview already keeps warm; opening the bar elsewhere reads them once.
  const power = useQuery(queries.power(server.id)).data;
  const factory = useQuery(queries.factory(server.id)).data;
  const labels = useMemo(() => itemLabels(factory?.data.buildings ?? []), [factory]);
  const groups = useMemo(
    () => paletteGroups({ isOperator, serverCount, power, factory, labels }),
    [isOperator, serverCount, power, factory, labels],
  );

  // autoFocus runs at mount. On a reopen (module already loaded) that is before the shell's
  // effect opens the <dialog>, so the input sits in a closed, display:none dialog and can't
  // take focus. Focus it once more after that effect, which runs later in the same flush.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    queueMicrotask(() => input.current?.focus());
  }, []);

  const run = (command: PaletteCommand) => {
    onDone();
    if (command.action === "changeServer") change();
    else if (command.to) navigate(command.to);
  };

  return (
    <Command
      label="Search the dashboard"
      loop
      // Whole words, not scattered letters (paletteScore); the item's value is only its id.
      filter={(_value, search, keywords) => paletteScore(search, keywords ?? [])}
      className="grid"
    >
      <Command.Input
        ref={input}
        autoFocus
        // Short enough for a phone; the groups below say what can be found.
        placeholder="Search the dashboard…"
        className="min-h-touch w-full rounded-none border-0 border-b border-line bg-transparent px-4 text-fg-strong outline-none"
      />
      <Command.List className="max-h-palette overflow-y-auto p-2">
        <Command.Empty className="px-3 py-4 text-sm text-muted">Nothing matches.</Command.Empty>
        {groups.map((group) => (
          <Command.Group
            key={group.heading}
            heading={group.heading}
            // cmdk marks a group's items role="group", which index.css lays out as a wrapping row of
            // buttons: here they're a list, one per line.
            className="[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:gap-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
          >
            {group.commands.map((command) => (
              <Command.Item
                key={command.id}
                value={command.id}
                keywords={[command.label, ...(command.keywords ?? [])]}
                onSelect={() => run(command)}
                className="flex min-h-touch cursor-pointer items-center justify-between gap-3 rounded-control px-3 text-sm data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg-strong"
              >
                <span className="min-w-0 truncate">{command.label}</span>
                {command.hint && <span className="flex-none text-xs text-muted">{command.hint}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  );
}
