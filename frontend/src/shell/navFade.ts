/** Slack in px: a scroller within this of an end counts as at it (fractional scroll positions). */
const SLACK = 1;

/**
 * The class that fades the main nav's sideways scroller where it can still scroll: a fade at the end while more lies
 * ahead, at the start once it has scrolled, both in between. Empty when everything fits. Phones only (`max-sm:`): the
 * tabs fit from `sm` up, and the desktop nav is not touched.
 */
export function navFadeClass(scrollLeft: number, clientWidth: number, scrollWidth: number): string {
  const more = scrollWidth - clientWidth > SLACK;
  if (!more) return "";
  const atStart = scrollLeft <= SLACK;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - SLACK;
  if (atStart && atEnd) return "";
  if (atStart) return "max-sm:nav-fade-end";
  if (atEnd) return "max-sm:nav-fade-start";
  return "max-sm:nav-fade-both";
}

/** Bring the active tab into view in the nav, without moving the page; instant under reduced motion. */
export function revealActiveTab(nav: HTMLElement | null) {
  const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!tab || typeof tab.scrollIntoView !== "function") return;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  tab.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduced ? "auto" : "smooth" });
}
