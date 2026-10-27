import {
  CreatePlannerDesignationRequestSchema,
  endpoints,
  ReplacePlannerDesignationsRequestSchema,
  UpdatePlannerDesignationRequestSchema,
  type SessionResponse,
  type SetAutoPauseRequest,
  type TestConnectionResponse,
} from "@satisfactory-dash/shared";
import * as alerts from "./alerts";
import { demoNow } from "./clock";
import { applyCreate, applyRemove, applyReplace, applyUpdate, type StoredDesignation, type WriteFailure } from "./designationStore";
import { demoDesignations, demoDesignationsResponse, resetDemoDesignations, setDemoDesignations, withDemoDesignations } from "./designations";
import { demoMetricsOverview } from "./metrics";
import { DEMO_PAIR_CODE } from "./pairCode";
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
  resetDemoDesignations();
}

const error = (status: number, code: string, message: string, reason?: string) =>
  Response.json({ error: { code, message, requestId: "demo", ...(reason === undefined ? {} : { reason }) } }, { status });

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
const BAD_DESIGNATION = () => error(400, "bad_request", "Invalid request");
const newDemoId = () => crypto.randomUUID();

/** A designation write's answer: the success (and the new list kept), or the backend's error envelope for its failure. */
function written(out: { ok: true; next: StoredDesignation[] } | WriteFailure, success: () => Response): Response {
  if (!out.ok) {
    return Response.json({ error: { code: out.code, message: out.message, requestId: "demo", ...(out.other === undefined ? {} : { other: out.other }) } }, { status: out.status });
  }
  setDemoDesignations(out.next);
  return success();
}
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
  // ADR-0056: the operator's metrics page. The demo user is the operator; `?window=` is validated like the real route.
  get(endpoints.metrics.overview.route, ({ params, request }) =>
    guarded(params, () => {
      const query = endpoints.metrics.overview.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!query.success) return error(400, "bad_request", "That metrics window isn't available.");
      return Response.json(demoMetricsOverview(demoNow(), query.data.window));
    }),
  ),
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
  // ADR-0046: the demo's list never says `selfServeEnabled`, so no screen offers "Add your server"; the route is
  // refused like every other server change, should something call it.
  post(endpoints.selfServe.createAgentServer.route, ({ params }) => guarded(params, NOT_SAVED)),
  // ADR-0051 section 1: the /pair page. One made-up code pairs with the made-up factory (nothing changes, it is already
  // there); any other code is the real API's 404, whatever the reason.
  post(endpoints.pairings.lookup.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    return guarded(params, () =>
      body.userCode === DEMO_PAIR_CODE
        ? Response.json({ serverName: "Demo factory PC", agentVersion: "0.1.0", requestedAt: new Date(demoNow() - 2 * 60_000).toISOString() })
        : error(404, "not_found", "No such pairing."),
    );
  }),
  post(endpoints.pairings.approve.route, async ({ params, request }) => {
    const body = await bodyOf(request);
    const target = body.target as { kind?: unknown; serverId?: unknown } | undefined;
    const ownTarget = target?.kind === "new" || (target?.kind === "existing" && target.serverId === world.DEMO_SERVER_ID);
    return guarded(params, () =>
      body.userCode === DEMO_PAIR_CODE && ownTarget ? Response.json({ serverId: world.DEMO_SERVER_ID }) : error(404, "not_found", "No such pairing."),
    );
  }),
  // ADR-0031: an agent server's rename and switch back to local are server changes too, refused alike.
  patch(endpoints.serverManagement.renameAgent.route, ({ params }) => guarded(params, NOT_SAVED)),
  post(endpoints.serverManagement.switchToLocal.route, ({ params }) => guarded(params, NOT_SAVED)),
  // ADR-0047: the demo visitor has no stored account (the session names no sign-in methods, so Settings offers no
  // deletion), and owns the demo server, so leaving it is refused as the real backend refuses an owner. Nothing changes.
  del(endpoints.account.remove.route, ({ params }) =>
    guarded(params, () => error(403, "forbidden", "The demo doesn't delete accounts.")),
  ),
  post(endpoints.members.leave.route, ({ params }) =>
    guarded(params, () =>
      error(409, "would_orphan", "You own this server. Remove it from Satisfactory Dash instead of leaving it.", "last_owner"),
    ),
  ),
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
  // ADR-0048 (#349): the bottleneck finder, a made-up answer for the demo factory.
  get(endpoints.bottlenecks.route, ({ params }) => guarded(params, () => Response.json(world.bottlenecks(demoNow())))),
  // ADR-0050: the production planner, a made-up two-site world over the demo factory's machines.
  get(endpoints.productionGraph.route, ({ params }) => guarded(params, () => Response.json(withDemoDesignations(world.productionGraph(demoNow()))))),
  // ADR-0055 PR 10a and #727: the planner's designations. One is made up (the plastic line); the writes change them in
  // memory for this visit (a reload starts over), so merge, split, pop-out, dissolve and undo show on the planner.
  get(endpoints.plannerDesignations.list.route, ({ params }) => guarded(params, () => Response.json(demoDesignationsResponse()))),
  post(endpoints.plannerDesignations.create.route, async ({ params, request }) => {
    const body = CreatePlannerDesignationRequestSchema.safeParse(await bodyOf(request));
    return guarded(params, () => {
      if (!body.success) return BAD_DESIGNATION();
      const out = applyCreate(demoDesignations(), body.data, demoNow(), newDemoId);
      return written(out, () => Response.json(out.ok ? out.designation : null, { status: 201 }));
    });
  }),
  put(endpoints.plannerDesignations.update.route, async ({ params, request }) => {
    const body = UpdatePlannerDesignationRequestSchema.safeParse(await bodyOf(request));
    return guarded(params, () => {
      if (!body.success) return BAD_DESIGNATION();
      const out = applyUpdate(demoDesignations(), String(params.designationId), body.data, demoNow());
      return written(out, () => Response.json(out.ok ? out.designation : null));
    });
  }),
  del(endpoints.plannerDesignations.remove.route, ({ params }) =>
    guarded(params, () => {
      const out = applyRemove(demoDesignations(), String(params.designationId));
      return written(out, () => Response.json({ deleted: true }));
    }),
  ),
  post(endpoints.plannerDesignations.replace.route, async ({ params, request }) => {
    const body = ReplacePlannerDesignationsRequestSchema.safeParse(await bodyOf(request));
    return guarded(params, () => {
      if (!body.success) return BAD_DESIGNATION();
      const out = applyReplace(demoDesignations(), body.data, demoNow(), newDemoId);
      return written(out, () => Response.json(out.ok ? out.response : null));
    });
  }),
  // ADR-0038 M5: the map's world layers, one made-up reading each. An unknown layer is a 404 like the real route.
  get(endpoints.map.worldLayer.route, ({ params }) =>
    guarded(params, () => {
      if (params.layer === "rails") return Response.json(world.railsWorld(demoNow()));
      if (params.layer === "resourceNodes") return Response.json(world.resourceNodesWorld(demoNow()));
      if (params.layer === "mapMarkers") return Response.json(world.mapMarkersWorld(demoNow()));
      if (params.layer === "powerLines") return Response.json(world.powerLinesWorld(demoNow()));
      return error(404, "not_found", "Unknown map layer");
    }),
  ),
  // ADR-0038 M6: two made-up trains running over the demo rails, worked out from the demo clock.
  get(endpoints.map.live.route, ({ params }) => guarded(params, () => Response.json(world.mapLive(demoNow())))),
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
  // ADR-0057: the version policy. Made up: the demo's agent (0.1.0) is one release behind, so visitors see "Update available".
  get(endpoints.compat.route, () => Response.json(world.compat())),
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
