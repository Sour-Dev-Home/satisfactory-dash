import { IS_DEMO } from "../mode";

/**
 * Marks an element as a tour step's target (ADR-0065 Decision 5): spread it on the element, `<section {...tour("x")}>`.
 * In the demo build it is `data-tour="x"`; in production `IS_DEMO` is false at build time, so it is `{}` and no
 * `data-tour` attribute reaches the bundle (e2e/build-output.spec.ts checks). Never a CSS class or visible text as a target.
 */
export function tour(id: string): { "data-tour"?: string } {
  return IS_DEMO ? { "data-tour": id } : {};
}
