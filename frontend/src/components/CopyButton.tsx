import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";

/** How long the check stays before the copy icon comes back. */
export const COPIED_MS = 2000;

type Result = "idle" | "copied" | "failed";

/**
 * Copies `text` to the clipboard (#328), for anything the user pastes elsewhere: an enrolment code,
 * a command. Icon-only, so `label` is its accessible name ("Copy the enrolment code"). The icon eases
 * to a check, and a polite live region says "Copied" (or why it couldn't: the clipboard needs a secure
 * page and the browser's permission). Motion comes from the tokens, and reduced motion is honoured in
 * one place (index.css).
 */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [result, setResult] = useState<Result>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      setResult("failed");
    }
    timer.current = setTimeout(() => setResult("idle"), COPIED_MS);
  };

  const copied = result === "copied";
  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={label}
        title={label}
        className={cn("relative inline-grid place-items-center px-0 min-w-touch", className)}
      >
        <Icon name="copy" visible={!copied} />
        <Icon name="check" visible={copied} />
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : result === "failed" ? "Couldn't copy. Select the text and copy it instead." : ""}
      </span>
    </>
  );
}

function Icon({ name, visible }: { name: "copy" | "check"; visible: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon={name}
      data-visible={visible}
      // Stacked in one grid cell, crossfading.
      className={cn(
        "col-start-1 row-start-1 size-5 transition-opacity",
        visible ? "opacity-100" : "opacity-0",
        name === "check" && "text-ok",
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "copy" ? (
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h8" />
        </>
      ) : (
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      )}
    </svg>
  );
}
