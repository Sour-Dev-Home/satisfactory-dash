import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * The disclosure tree's parts (ADR-0062 Decision 3 and F.2), shared by the Planner's outline and the Factory page's grouped
 * machine table: a heading at a computed level, the chevron cue, a heading whose words are its disclosure button
 * (`aria-expanded`); the viewer's open and closed choices are `useDisclosures.ts`. A nested list of headings and buttons,
 * not an ARIA tree.
 */

/** A heading at `level`, clamped to h2..h6, so a deep tree never asks for an h7. */
export function TreeHeading({ level, id, className, children }: { level: number; id?: string; className?: string; children: ReactNode }) {
  const Tag = `h${Math.min(Math.max(level, 2), 6)}` as "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag id={id} className={cn("m-0 break-words", className)}>
      {children}
    </Tag>
  );
}

/** A disclosure's open or closed cue beside its words (the state itself is `aria-expanded`): points right, then down. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={cn("inline-block size-4 shrink-0 text-muted", open && "rotate-90")}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/**
 * A heading whose words are the button that opens and closes what `controls` names. `after` sits in the heading after the
 * button (counts, say): read with the heading, outside the button's name, so the name stays the same as the counts change.
 */
export function DisclosureHeading({
  level,
  open,
  onToggle,
  controls,
  id,
  after,
  children,
}: {
  level: number;
  open: boolean;
  onToggle: () => void;
  controls: string;
  id?: string;
  after?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TreeHeading level={level} id={id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className="inline-flex min-h-touch items-center gap-1 break-words text-left"
      >
        <Chevron open={open} />
        {children}
      </button>
      {after}
    </TreeHeading>
  );
}
