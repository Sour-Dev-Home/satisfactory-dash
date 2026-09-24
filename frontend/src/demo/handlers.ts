import { endpoints, type SessionResponse, type SetAutoPauseRequest } from "@satisfactory-dash/shared";
import { demoNow } from "./clock";
import { get, post, put, type Params } from "./router";
import * as world from "./world";

/**
 * The demo API (ADR-0026): the real endpoints' routes as MSW-style handlers, answered in the
 * page by demo/transport.ts (no service worker, no network). Only routes the real API has;
 * anything else is a visible "no demo data" error, never a request.
 */

const SIGNED_IN: SessionResponse = { authenticated: true, user: { name: "Demo visitor" } };
const SIGNED_OUT: SessionResponse = { authenticated: false };

/** How long an auto-pause change shows as pending before it's applied, like a real server. */
export const PENDING_MS = 6000;

/** Everything a visit changes, in memory only: a reload starts over. */
const state = { signedIn: false, autoPause: false, pendingUntil: 0 };

export function resetDemoState(): void {
  Object.assign(state, { signedIn: false, autoPause: false, pendingUntil: 0 });
}

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, requestId: "demo" } }, { status });

/** Data routes behave like the real API: signed out is a 401, an unknown server a 404. */
function guarded(params: Params, respond: () => Response): Response {
  if (!state.signedIn) return error(401, "unauthorized", "Sign in to see this.");
  if (params.serverId !== undefined && params.serverId !== world.DEMO_SERVER_ID) {
    return error(404, "server_not_found", "That server doesn't exist in the demo.");
  }
  return respond();
}

const settingsNow = () => {
  const pending = Date.now() < state.pendingUntil;
  return world.settings(demoNow(), { autoPause: state.autoPause, pending });
};

export const demoHandlers = [
  get(endpoints.health.route, () => Response.json({ status: "ok" })),

  get(endpoints.auth.session.route, () => Response.json(state.signedIn ? SIGNED_IN : SIGNED_OUT)),
  // "Enter demo" signs in without credentials; there's nothing to protect.
  post(endpoints.auth.login.route, () => {
    state.signedIn = true;
    return Response.json(SIGNED_IN);
  }),
  post(endpoints.auth.logout.route, () => {
    state.signedIn = false;
    return Response.json(SIGNED_OUT);
  }),

  get(endpoints.servers.route, ({ params }) => guarded(params, () => Response.json(world.servers))),
  get(endpoints.status.route, ({ params }) => guarded(params, () => Response.json(world.status(demoNow())))),
  get(endpoints.power.route, ({ params }) => guarded(params, () => Response.json(world.power(demoNow())))),
  get(endpoints.powerHistory.route, ({ params }) =>
    guarded(params, () => Response.json(world.powerHistory(demoNow()))),
  ),
  get(endpoints.factory.route, ({ params }) => guarded(params, () => Response.json(world.factory(demoNow())))),
  get(endpoints.settings.get.route, ({ params }) => guarded(params, () => Response.json(settingsNow()))),
  // A simulated write: in memory only, pending for a moment, then applied. Never sent anywhere.
  put(endpoints.settings.setAutoPause.route, async ({ params, request }) => {
    const body = (await request.json()) as SetAutoPauseRequest;
    return guarded(params, () => {
      state.autoPause = body.enabled;
      state.pendingUntil = Date.now() + PENDING_MS;
      return Response.json(settingsNow());
    });
  }),
];
