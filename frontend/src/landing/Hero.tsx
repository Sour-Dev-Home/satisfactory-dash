import type { ReactNode } from "react";
import { Logo } from "../ui/Logo";
import { PREVIEW } from "./preview";

/**
 * The landing page's and the demo gate's opening (#444): the logo, one sentence on what Satis Manager
 * does, its actions, and the Overview still below. Static and presentational: no queries, no auth.
 * Nothing in it animates in: the text is the first paint, and the still keeps its box while it loads.
 */
export function Hero({ headingId, title, children }: { headingId: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-8">
      <section aria-labelledby={headingId} className="grid max-w-3xl justify-items-start gap-5">
        {/* The header's h1 already names the site: this repeat is the brand, so it isn't read twice. */}
        <span aria-hidden="true">
          <Logo size="hero" />
        </span>
        <h2
          id={headingId}
          className="m-0 font-sans text-2xl leading-tight font-semibold tracking-normal normal-case sm:text-3xl"
        >
          {title}
        </h2>
        {children}
      </section>
      <figure className="m-0 grid gap-2">
        <img
          src={PREVIEW.src}
          width={PREVIEW.width}
          height={PREVIEW.height}
          alt={PREVIEW.alt}
          // The largest thing on a desktop screen, so it's the LCP: fetch it first, decode off the main thread.
          fetchPriority="high"
          decoding="async"
          className="h-auto w-full rounded-card border border-line bg-surface"
        />
        <figcaption className="text-sm text-muted">The Overview, from the live demo's made-up factory.</figcaption>
      </figure>
    </div>
  );
}
