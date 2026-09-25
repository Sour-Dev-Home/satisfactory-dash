import type { Transport } from "../api/transport";
import { demoHandlers } from "./handlers";
import { resolve } from "./router";

/**
 * The demo build's transport (ADR-0026). vite.config.ts swaps it in for api/transport.ts in
 * `--mode demo`, so the demo bundle holds no network transport at all. Each request is
 * answered in the page by the demo handlers (demo/router.ts): no service worker (those fail
 * in private windows and in-app browsers), no fetch, no network.
 *
 * A request the demo has no handler for gets a visible error, never a fallthrough to the
 * network.
 */

/** The demo has no backend to navigate to (and shows no Google button); same-origin path only. */
export const apiHref = (path: string): string => path;

export const transport: Transport = async (path, init) => {
  init.signal?.throwIfAborted();
  const origin = window.location.origin;
  const request = new Request(new URL(path, origin), {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal ?? undefined,
  });
  let response: Response | undefined;
  try {
    response = await resolve(demoHandlers, request);
  } catch (cause) {
    // A handler bug is a server error, like the real API's 500, not "unreachable".
    console.error(`[demo] handler failed for ${request.method} ${path}`, cause);
    return Response.json(
      { error: { code: "internal", message: "The demo hit an error answering this.", requestId: "demo" } },
      { status: 500 },
    );
  }
  if (response) return response;

  console.error(`[demo] no demo data for ${request.method} ${path}`);
  return Response.json(
    { error: { code: "not_found", message: `The demo has no data for ${request.method} ${path}.`, requestId: "demo" } },
    { status: 404 },
  );
};
