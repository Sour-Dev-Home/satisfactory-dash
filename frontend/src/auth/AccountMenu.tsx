import { useEffect, useId, useRef, useState } from "react";
import { LogoutButton } from "./LogoutButton";
import { useSignedInUser } from "./SignedInUser";

/**
 * The account menu in the shell's top bar (ADR-0025): who is signed in, "Sign out", and "Sign
 * out everywhere" (every session of this account). A non-modal disclosure (ADR-0016 item 8):
 * Escape or a click outside closes it.
 */
export function AccountMenu() {
  const user = useSignedInUser();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div ref={root} className="relative">
      <button ref={toggle} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        Account
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 z-10 mt-2 grid w-64 gap-2 rounded-card border border-line bg-surface p-4 shadow-lg"
        >
          <p className="text-sm">
            <span className="text-muted">Signed in as </span>
            <span className="font-semibold text-fg-strong">{user.name}</span>
          </p>
          {user.email && <p className="-mt-1 truncate text-sm text-muted">{user.email}</p>}
          <LogoutButton />
          <LogoutButton everywhere />
        </div>
      )}
    </div>
  );
}
