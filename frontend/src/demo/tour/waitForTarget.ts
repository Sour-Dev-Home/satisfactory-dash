/**
 * Waiting for a step's target (ADR-0065 Decision 4). A target is ready once it exists, sits inside a revealed page
 * (`[data-page-reveal="revealed"]`, ui/PageReveal.tsx) or outside any reveal wrapper, and has a non-empty box. Checked on
 * every DOM change (a MutationObserver) and every animation frame (a page fades in, a lazy chunk lays out with no DOM
 * change), until TOUR_TARGET_WAIT_MS passes: then the step shows centred with no highlight, and the tour goes on.
 */
export const TOUR_TARGET_WAIT_MS = 6000;

export function targetSelector(id: string): string {
  return `[data-tour="${CSS.escape(id)}"]`;
}

/** Whether this element can be highlighted now. */
export function isTargetReady(el: Element): boolean {
  if (!el.isConnected) return false;
  const reveal = el.closest("[data-page-reveal]");
  if (reveal !== null && reveal.getAttribute("data-page-reveal") !== "revealed") return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

/** The first element marked with this id that is ready, if any. */
export function findReadyTarget(id: string, root: ParentNode = document): Element | null {
  for (const el of root.querySelectorAll(targetSelector(id))) if (isTargetReady(el)) return el;
  return null;
}

/**
 * How long a step's target on a newly opened page must keep the same box (within SETTLE_SLACK_PX) before the step shows
 * (ADR-0065 amendment, 2026-11-07): a lazy chunk mounting, a chart laying out or a canvas fitting its view moves the box
 * for a few frames after the page reveals, and a ring shown then pops about.
 */
export const TOUR_SETTLE_MS = 200;
/** A box that moved by no more than this, on every edge, counts as still. */
export const SETTLE_SLACK_PX = 1;

const near = (a: DOMRect, b: DOMRect) =>
  Math.abs(a.x - b.x) <= SETTLE_SLACK_PX &&
  Math.abs(a.y - b.y) <= SETTLE_SLACK_PX &&
  Math.abs(a.width - b.width) <= SETTLE_SLACK_PX &&
  Math.abs(a.height - b.height) <= SETTLE_SLACK_PX;

/**
 * Calls `onFound` with the target once it is ready, or `onTimeout` after `timeoutMs`; exactly one of them, once.
 * With `settleMs`, ready also means its box has stayed put (measured on animation frames) for that long; a box still
 * moving at `timeoutMs` times out like a missing one. Returns a cancel, which calls neither.
 */
export function waitForTarget(
  id: string,
  {
    onFound,
    onTimeout,
    timeoutMs = TOUR_TARGET_WAIT_MS,
    settleMs = 0,
  }: { onFound: (el: Element) => void; onTimeout: () => void; timeoutMs?: number; settleMs?: number },
): () => void {
  let done = false;
  let frame = 0;
  // The element being watched for stillness, the box it had when it last moved, and when that was.
  let still: { el: Element; box: DOMRect; since: number } | null = null;
  const finish = () => {
    done = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
  const found = (el: Element) => {
    finish();
    onFound(el);
  };
  const check = () => {
    if (done) return;
    const el = findReadyTarget(id);
    if (el === null) {
      still = null;
      return;
    }
    if (settleMs <= 0) {
      found(el);
      return;
    }
    const box = el.getBoundingClientRect();
    const now = performance.now();
    if (still === null || still.el !== el || !near(still.box, box)) {
      still = { el, box, since: now };
      return;
    }
    if (now - still.since >= settleMs) found(el);
  };
  const tick = () => {
    check();
    if (!done) frame = requestAnimationFrame(tick);
  };
  const observer = new MutationObserver(check);
  const timer = setTimeout(() => {
    if (done) return;
    finish();
    onTimeout();
  }, timeoutMs);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-page-reveal", "data-tour", "class"] });
  tick();
  return () => {
    if (!done) finish();
  };
}
