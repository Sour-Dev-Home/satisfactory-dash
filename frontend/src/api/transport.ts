/**
 * Where an API request actually goes (ADR-0026's seam). client.ts builds and parses every
 * request and hands it here to be sent; this module is the only one that calls fetch.
 *
 * The production build sends it over the network to VITE_API_URL. The demo build (a
 * separate `--mode demo` build on its own origin) swaps this module for an in-process
 * resolver, so the real transport is never in the demo bundle and the demo code never in
 * the production one.
 */
export type Transport = (path: string, init: RequestInit) => Promise<Response>;

// Empty in development: Vite proxies /api to the backend, so the browser sees one origin.
// Trimmed because a stray space in the build variable would otherwise end up in every URL.
const BASE_URL = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

export const transport: Transport = (path, init) => fetch(BASE_URL + path, init);

// A string the minifier can't drop, so e2e/build-output.spec.ts can prove this module is in the
// production bundle and absent from the demo one, whatever it does with the base URL.
Object.defineProperty(transport, "name", { value: "satisManagerNetworkTransport" });
