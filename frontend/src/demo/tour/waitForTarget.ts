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
 * Calls `onFound` with the target once it is ready, or `onTimeout` after `timeoutMs`; exactly one of them, once.
 * Returns a cancel, which calls neither.
 */
export function waitForTarget(
  id: string,
  { onFound, onTimeout, timeoutMs = TOUR_TARGET_WAIT_MS }: { onFound: (el: Element) => void; onTimeout: () => void; timeoutMs?: number },
): () => void {
  let done = false;
  let frame = 0;
  const finish = () => {
    done = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
  const check = () => {
    if (done) return;
    const el = findReadyTarget(id);
    if (el === null) return;
    finish();
    onFound(el);
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
