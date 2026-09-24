/**
 * A tiny in-process router for the demo API (ADR-0026). MSW's getResponse would do the same
 * job, but its core bundles a cookie library with the public-suffix list: +330 kB on the
 * demo's main chunk (786 kB instead of 454 kB) for cookies the demo never uses. This keeps
 * MSW's handler shape (method, route pattern, resolver) without it.
 */

export type Params = Record<string, string>;
export type Resolver = (args: { params: Params; request: Request }) => Response | Promise<Response>;

export interface DemoHandler {
  method: string;
  /** An Express-style route from `endpoints`, e.g. /api/servers/:serverId/power. */
  route: string;
  resolver: Resolver;
}

const route =
  (method: string) =>
  (routePattern: string, resolver: Resolver): DemoHandler => ({ method, route: routePattern, resolver });

export const get = route("GET");
export const post = route("POST");
export const put = route("PUT");

/** Matches a whole path; each :name segment captures one URL-decoded segment. */
function match(routePattern: string, pathname: string): Params | null {
  const want = routePattern.split("/");
  const got = pathname.split("/");
  if (want.length !== got.length) return null;
  const params: Params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(":")) {
      if (!got[i]) return null;
      params[want[i].slice(1)] = decodeURIComponent(got[i]);
    } else if (want[i] !== got[i]) {
      return null;
    }
  }
  return params;
}

/** The first handler for the request's method and path, or undefined if none. */
export async function resolve(handlers: readonly DemoHandler[], request: Request): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  for (const handler of handlers) {
    if (handler.method !== request.method) continue;
    const params = match(handler.route, pathname);
    if (params) return handler.resolver({ params, request });
  }
  return undefined;
}
