import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useSkeletonClock } from "./skeletonClock";

/**
 * One block of a loading panel: a rounded surface-2 bar with a slow shimmer (opacity only, off under
 * reduced motion). Size it with the same utilities as the content it stands for (`h-lh` is one line
 * of the surrounding text). Decorative: the panel's `SkeletonStatus` carries the words.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" data-skeleton="" className={cn("rounded-md bg-surface-2 motion-safe:animate-shimmer", className)} />;
}

/** The loading announcement for a panel: read by screen readers, never seen. */
export function SkeletonStatus({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="sr-only">
      {children}
    </p>
  );
}

/** One line of text height standing in for a line of loading content, with its announcement. */
export function SkeletonLine({ label, className }: { label: string; className?: string }) {
  return (
    <div className={className}>
      <SkeletonStatus>{label}</SkeletonStatus>
      <Skeleton className="h-lh w-24" />
    </div>
  );
}

/**
 * A `.panel` made of skeleton blocks: a heading bar, then `rows` bars of `rowClass` height (Tailwind
 * scale), sized to stand in for the panel's final content. `label` is the loading announcement.
 */
export function PanelSkeleton({
  label,
  rows = 2,
  rowClass = "h-16",
  heading = true,
  className,
  children,
}: {
  label: string;
  rows?: number;
  rowClass?: string;
  heading?: boolean;
  className?: string;
  /** More blocks after the rows (the map's canvas). */
  children?: ReactNode;
}) {
  return (
    <section aria-busy="true" className={cn("panel", className)}>
      <SkeletonStatus>{label}</SkeletonStatus>
      {heading && <Skeleton className="h-lh w-32 text-xl" />}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={rowClass} />
      ))}
      {children}
    </section>
  );
}

/**
 * A panel's loading branch (#494): `skeleton` while `pending` (shaped like the panel, so the layout
 * doesn't move), then `children`, faded in when they replace a skeleton. During the show-delay the
 * skeleton's box is already there but unseen (`invisible`), so nothing moves when it appears either.
 * `className` goes on the wrapper in both states (a grid gap, a column span).
 */
export function Loadable({
  pending,
  skeleton,
  className,
  children,
}: {
  pending: boolean;
  skeleton: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { show, visible } = useSkeletonClock(pending);
  const [sawSkeleton, setSawSkeleton] = useState(false);
  if (visible && !sawSkeleton) setSawSkeleton(true);
  if (show) {
    return (
      <div data-loadable="" data-loading={visible ? "shown" : "waiting"} className={cn(className, !visible && "invisible")}>
        {skeleton}
      </div>
    );
  }
  // Only a swap from a skeleton fades: content that was there from the start comes in with its page.
  return <div data-loadable="" className={cn(className, sawSkeleton && "animate-reveal")}>{children}</div>;
}
