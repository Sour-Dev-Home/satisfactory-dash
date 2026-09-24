/**
 * True only in the demo build (`vite build --mode demo`, ADR-0026). A build-time constant, so
 * in the production build every `IS_DEMO &&` branch, and the demo UI it imports, is removed;
 * e2e/build-output.spec.ts checks that no demo text reaches the production bundle.
 */
export const IS_DEMO = import.meta.env.MODE === "demo";
