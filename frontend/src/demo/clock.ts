import { DEMO_EPOCH } from "./world";

/**
 * The demo's "now". `?clock=fixed` on the first page load pins it to DEMO_EPOCH, so renders
 * (screenshots, the walkthrough video) are identical on every run; otherwise it's real time,
 * and the power chart moves.
 */
const fixed = new URLSearchParams(window.location.search).get("clock") === "fixed";

export const demoNow = (): number => (fixed ? DEMO_EPOCH : Date.now());
