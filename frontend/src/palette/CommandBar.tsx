import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useNavigate } from "react-router";
import { queries } from "../api/queries";
import { itemLabels } from "../factory/itemLabels";
import { useSelectedServer, useServerSwitch } from "../servers/ServerContext";
import { isPaletteShortcut, paletteGroups, type PaletteCommand } from "./paletteCommands";

/**
 * The command bar (#351): Ctrl+K / Cmd+K anywhere in the app, or the header's Search button, opens a
 * search over pages, settings, circuits, machines and items, and Enter jumps there. Modal by
 * convention (the owner's exception to ADR-0016 item 8). The dialog is a native <dialog> opened with
 * showModal(): a real modal (the page behind is inert; Esc closes), with no library dialog, because
 * Radix Dialog's scroll lock injects a <style> element that the CSP (style-src 'self') blocks. cmdk
 * does the input, the list, the matching and the arrow keys. Focus goes back where it was on close.
 */
export function CommandBar() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Where focus was, taken as the bar opens: by the time an effect runs, the search box has it.
  const rememberFocus = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const openBar = () => {
    rememberFocus();
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      if (!dialog.current?.hasAttribute("open")) rememberFocus();
      setOpen((wasOpen) => !wasOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // The attribute, not `el.open`: the same in every browser, and set even where showModal isn't.
    const shown = el.hasAttribute("open");
    if (open && !shown) {
      // jsdom has no showModal; the attribute is the same dialog, just not modal.
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && shown) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
      returnFocus.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={openBar}
        aria-label="Search (Ctrl+K)"
        title="Search (Ctrl+K)"
        aria-haspopup="dialog"
        className="inline-grid min-w-touch place-items-center px-0"
      >
        <SearchIcon />
      </button>
      <dialog
        ref={dialog}
        aria-label="Search"
        // Esc: the browser closes a modal dialog itself; keep the state in step.
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => {
          if (e.target === dialog.current) setOpen(false);
        }}
        // The browser's own dialog styles cap the width with a margin, so a phone keeps its gutter.
        className="mx-auto mt-16 w-palette animate-pop rounded-card border border-line bg-surface p-0 text-fg shadow-lg backdrop:bg-canvas/70 max-sm:mt-4"
      >
        {open && <Palette onDone={() => setOpen(false)} />}
      </dialog>
    </>
  );
}

/** The search itself, mounted only while open, so its queries run only then. */
function Palette({ onDone }: { onDone: () => void }) {
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

  const run = (command: PaletteCommand) => {
    onDone();
    if (command.action === "changeServer") change();
    else if (command.to) navigate(command.to);
  };

  return (
    <Command label="Search the dashboard" loop className="grid">
      <Command.Input
        autoFocus
        placeholder="Search pages, settings, circuits, machines, items…"
        className="min-h-touch w-full rounded-none border-0 border-b border-line bg-transparent px-4 text-fg-strong outline-none"
      />
      <Command.List className="max-h-palette overflow-y-auto p-2">
        <Command.Empty className="px-3 py-4 text-sm text-muted">Nothing matches.</Command.Empty>
        {groups.map((group) => (
          <Command.Group
            key={group.heading}
            heading={group.heading}
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
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

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="search"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}
