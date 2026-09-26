import {
  endpoints,
  type SessionResponse,
  type SetAutoPauseRequest,
  type TestConnectionResponse,
} from "@satisfactory-dash/shared";
import * as alerts from "./alerts";
import { demoNow } from "./clock";
import { del, get, patch, post, put, type Params } from "./router";
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
  alerts.resetDemoAlerts();
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

/** The demo's stand-in for the backend's loopback check (ADR-0030 amendment 1). */
const onThisMachine = (host: unknown) =>
  typeof host === "string" && /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i.test(host.trim());

const LAN_REFUSED = () => error(422, "lan_requires_cert_pinning", "Only loopback servers can be used for now.");

// Server management (ADR-0030) in the demo: the screens work and the connection test is simulated
// (nothing is contacted), but nothing is saved, and a LAN server is refused like the real backend.
const NOT_SAVED = () => error(403, "forbidden", "The demo doesn't change servers.");
const TEST_PASSED: TestConnectionResponse = { ok: true, api: { ok: true }, frm: { ok: true } };

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const answer = ({ status, body }: { status: number; body: unknown }) => Response.json(body, { status });

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
  // The demo has one session (this tab), so "everywhere" is the same as here.
  post(endpoints.auth.logoutAll.route, () => {
    state.signedIn = false;
    return Response.json(SIGNED_OUT);
  }),

  get(endpoints.servers.route, ({ params }) => guarded(params, () => Response.json(world.servers))),
  get(endpoints.serverManagement.list.route, ({ params }) => guarded(params, () => Response.json(world.managedServers))),
  post(endpoints.serverManagement.testConnection.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () => (onThisMachine(body.host) ? Response.json(TEST_PASSED) : LAN_REFUSED()));
  }),
  post(endpoints.serverManagement.testSaved.route, ({ params }) => guarded(params, () => Response.json(TEST_PASSED))),
  post(endpoints.serverManagement.create.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () => (onThisMachine(body.host) ? NOT_SAVED() : LAN_REFUSED()));
  }),
  patch(endpoints.serverManagement.update.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () => (body.host === undefined || onThisMachine(body.host) ? NOT_SAVED() : LAN_REFUSED()));
  }),
  del(endpoints.serverManagement.remove.route, ({ params }) => guarded(params, NOT_SAVED)),
  get(endpoints.status.route, ({ params }) => guarded(params, () => Response.json(world.status(demoNow())))),
  get(endpoints.players.route, ({ params }) => guarded(params, () => Response.json(world.players(demoNow())))),
  get(endpoints.power.route, ({ params }) => guarded(params, () => Response.json(world.power(demoNow())))),
  get(endpoints.powerHistory.route, ({ params }) =>
    guarded(params, () => Response.json(world.powerHistory(demoNow()))),
  ),
  // ADR-0027 stored history: `?range=` validated like the real route (a bad value is a 400).
  get(endpoints.history.power.route, ({ params, request }) =>
    guarded(params, () => {
      const query = endpoints.history.power.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!query.success) return error(400, "bad_request", "Invalid request: range");
      return Response.json(world.historyPower(demoNow(), query.data.range));
    }),
  ),
  get(endpoints.factory.route, ({ params }) => guarded(params, () => Response.json(world.factory(demoNow())))),
  // Stored history (ADR-0027): the same query rules as the backend's, so a bad range is a 400 here too.
  get(endpoints.history.items.route, ({ params, request }) =>
    guarded(params, () => {
      const query = endpoints.history.items.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!query.success) return error(400, "bad_request", "That history range isn't available.");
      return Response.json(world.historyItems(demoNow(), query.data.range, query.data.item));
    }),
  ),
  get(endpoints.history.transitions.route, ({ params, request }) =>
    guarded(params, () => {
      const query = endpoints.history.transitions.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!query.success) return error(400, "bad_request", "That history range isn't available.");
      return Response.json(world.historyTransitions(demoNow(), query.data.range, query.data.limit));
    }),
  ),
  get(endpoints.settings.get.route, ({ params }) => guarded(params, () => Response.json(settingsNow()))),
  // A simulated write: in memory only, pending for a moment, then applied. Never sent anywhere.
  put(endpoints.settings.setAutoPause.route, async ({ params, request }) => {
    let body: SetAutoPauseRequest;
    try {
      body = (await request.json()) as SetAutoPauseRequest;
    } catch {
      return error(400, "bad_request", "The request body isn't valid JSON.");
    }
    return guarded(params, () => {
      state.autoPause = body.enabled;
      state.pendingUntil = Date.now() + PENDING_MS;
      return Response.json(settingsNow());
    });
  }),

  // The game PC agent (ADR-0031 PR 7). A code can be shown; revoking is refused, like server changes.
  get(endpoints.agent.status.route, ({ params }) => guarded(params, () => Response.json(world.agent(demoNow())))),
  post(endpoints.agent.enrollmentCode.route, ({ params }) =>
    guarded(params, () => Response.json(world.enrollmentCode(demoNow()), { status: 201 })),
  ),
  del(endpoints.agent.revoke.route, ({ params }) =>
    guarded(params, () => error(403, "forbidden", "The demo doesn't revoke its agent.")),
  ),

  // Alerts (ADR-0027 PR 9): the demo's own rules, log and pretend webhook (demo/alerts.ts). Writes
  // change this tab's memory only; "Send test" never contacts Discord.
  get(endpoints.alerts.status.route, ({ params }) => guarded(params, () => Response.json(alerts.status(demoNow())))),
  get(endpoints.alerts.rules.list.route, ({ params }) =>
    guarded(params, () => Response.json({ rules: alerts.rules(demoNow()) })),
  ),
  post(endpoints.alerts.rules.create.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () => answer(alerts.createRule(demoNow(), body)));
  }),
  patch(endpoints.alerts.rules.update.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () => answer(alerts.updateRule(demoNow(), params.ruleId ?? "", body)));
  }),
  del(endpoints.alerts.rules.remove.route, ({ params }) =>
    guarded(params, () => answer(alerts.deleteRule(demoNow(), params.ruleId ?? ""))),
  ),
  get(endpoints.alerts.destinations.get.route, ({ params }) =>
    guarded(params, () => Response.json(alerts.destinations(demoNow()))),
  ),
  put(endpoints.alerts.destinations.putDiscord.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () => answer(alerts.putDiscord(demoNow(), body)));
  }),
  patch(endpoints.alerts.destinations.patchDiscord.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () => answer(alerts.patchDiscord(demoNow(), body)));
  }),
  del(endpoints.alerts.destinations.removeDiscord.route, ({ params }) =>
    guarded(params, () => answer(alerts.deleteDiscord(demoNow()))),
  ),
  post(endpoints.alerts.destinations.testDiscord.route, ({ params }) =>
    guarded(params, () => answer(alerts.testDiscord(demoNow()))),
  ),
  get(endpoints.alerts.events.route, ({ params, request }) =>
    guarded(params, () => {
      const query = endpoints.alerts.events.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!query.success) return error(400, "bad_request", "That page of the alert log isn't available.");
      return Response.json(alerts.events(demoNow(), query.data.limit, query.data.before));
    }),
  ),
  put(endpoints.alerts.mute.set.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () => answer(alerts.setMute(demoNow(), body)));
  }),
  del(endpoints.alerts.mute.clear.route, ({ params }) => guarded(params, () => answer(alerts.clearMute()))),
];
