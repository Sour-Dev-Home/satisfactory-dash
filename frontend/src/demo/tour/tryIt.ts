import type { TourDone } from "./steps";
import { targetSelector } from "./waitForTarget";

/**
 * Try-it steps (ADR-0065 Decision 6): the tour sees a step done by what appears or changes on the page, never by reading
 * a page's state. Returns the stop; `onDone` is called at most once.
 *
 * - `appears`: an element with that `data-tour` that was not there when the watch began (so Back onto a step whose panel
 *   is still open does not finish it again at once).
 * - `changes`: a `change` event on or inside an element with that `data-tour` (seen in the capture phase, so a page
 *   handler that stops it cannot hide it).
 */
export function watchDone(done: TourDone, onDone: () => void): () => void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    stop();
    onDone();
  };
  let stop: () => void;
  if ("appears" in done) {
    const selector = targetSelector(done.appears);
    const before = new Set(document.querySelectorAll(selector));
    const check = () => {
      for (const el of document.querySelectorAll(selector)) if (!before.has(el)) return finish();
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-tour"] });
    stop = () => observer.disconnect();
  } else {
    const selector = targetSelector(done.changes);
    const onChange = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(selector) !== null) finish();
    };
    document.addEventListener("change", onChange, true);
    stop = () => document.removeEventListener("change", onChange, true);
  }
  return () => {
    finished = true;
    stop();
  };
}

/**
 * "Do it for me": a bubbling click on the target, through the page's own handlers (an SVG card has no `.click()`). A
 * label is pressed through its control, so a checkbox toggles and fires `change` as a real tick does.
 */
export function pressTarget(el: Element): boolean {
  const press = el instanceof HTMLLabelElement && el.control !== null ? el.control : el;
  // Already ticked: pressing would untick it, the opposite of what the step asks. Nothing is pressed.
  if (press instanceof HTMLInputElement && press.type === "checkbox" && press.checked) return false;
  press.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return true;
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export type Focusable = HTMLElement | SVGElement;

const isFocusable = (el: Element): el is Focusable => (el instanceof HTMLElement || el instanceof SVGElement) && el.matches(FOCUSABLE);

/**
 * Where Tab reaches a try-it step's target (ADR-0065 Decision 9): the step's `keyTarget` (the planner's card is drawn; its
 * keyboard path is a visually hidden button), else the target itself when it takes focus, else the first thing inside it
 * that does (a label's checkbox).
 */
export function tabStopOf(target: Element, keyTarget?: string): Focusable | null {
  if (keyTarget !== undefined) {
    const el = document.querySelector(targetSelector(keyTarget));
    return el !== null && isFocusable(el) ? el : null;
  }
  if (isFocusable(target)) return target;
  const inside = target.querySelector(FOCUSABLE);
  return inside !== null && isFocusable(inside) ? inside : null;
}

/**
 * Brings a target the page draws (the planner's SVG card, which `scrollIntoView` cannot reach inside its pannable canvas)
 * into view the way a keyboard user does: its keyboard path is focused, and the page pans to it on focus. Focus then goes
 * straight back to where it was. Without this a phone's planner can leave the highlighted card off the screen.
 */
export function revealByKeyPath(keyTarget: string): void {
  const el = document.querySelector(targetSelector(keyTarget));
  if (el === null || !isFocusable(el)) return;
  const back = document.activeElement;
  el.focus({ preventScroll: true });
  if (back instanceof HTMLElement || back instanceof SVGElement) back.focus({ preventScroll: true });
  else el.blur();
}

/** Whether a key press in this element is typing (Escape there belongs to the field, not the tour). */
export function isTypingField(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable === true; // undefined in jsdom
}
