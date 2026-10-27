import { HealthResponseSchema, ReadinessResponseSchema } from "./health";
import { ServerListResponseSchema } from "./servers";
import {
  CreateAgentServerRequestSchema,
  CreateAgentServerResponseSchema,
  CreateServerRequestSchema,
  DeleteServerResponseSchema,
  ManagedServerListResponseSchema,
  RenameServerRequestSchema,
  SwitchToLocalRequestSchema,
  RenameServerResponseSchema,
  ServerConnectionResponseSchema,
  TestConnectionRequestSchema,
  TestConnectionResponseSchema,
  UpdateServerRequestSchema,
} from "./serverManagement";
import { StatusResponseSchema } from "./status";
import { FactoryResponseSchema } from "./factory";
import { BottlenecksQuerySchema, BottlenecksResponseSchema } from "./bottlenecks";
import { ProductionGraphResponseSchema } from "./productionGraph";
import {
  CreatePlannerDesignationRequestSchema,
  DeletePlannerDesignationResponseSchema,
  PlannerDesignationSchema,
  PlannerDesignationsResponseSchema,
  ReplacePlannerDesignationsRequestSchema,
  ReplacePlannerDesignationsResponseSchema,
  UpdatePlannerDesignationRequestSchema,
} from "./plannerDesignations";
import { PowerResponseSchema } from "./power";
import { PowerHistoryResponseSchema } from "./powerHistory";
import {
  HistoryItemsQuerySchema,
  HistoryItemsResponseSchema,
  HistoryPowerQuerySchema,
  HistoryPowerResponseSchema,
  HistoryTransitionsQuerySchema,
  HistoryTransitionsResponseSchema,
} from "./history";
import { ServerPlayersResponseSchema } from "./players";
import { MapLiveResponseSchema, MapWorldLayerResponseSchema, WorldIngestResponseSchema } from "./map";
import { LoginRequestSchema, SessionResponseSchema } from "./auth";
import { DeleteAccountResponseSchema, LeaveServerResponseSchema } from "./account";
import { SetAutoPauseRequestSchema, SettingsResponseSchema } from "./settings";
import {
  AlertDestinationsResponseSchema,
  AlertEventsQuerySchema,
  AlertEventsResponseSchema,
  AlertRuleResponseSchema,
  AlertRulesResponseSchema,
  AlertStatusResponseSchema,
  CreateAlertRuleRequestSchema,
  DeleteAlertRuleResponseSchema,
  DeleteDestinationResponseSchema,
  DiscordDestinationResponseSchema,
  MuteClearedResponseSchema,
  MuteSetResponseSchema,
  PatchDiscordDestinationRequestSchema,
  PutDiscordDestinationRequestSchema,
  PushConfigResponseSchema,
  PushOptInRequestSchema,
  PushOptInResponseSchema,
  PushSubscribeRequestSchema,
  PushSubscribeResponseSchema,
  PushTestResponseSchema,
  PushUnsubscribeResponseSchema,
  SendTestResponseSchema,
  SetMuteRequestSchema,
  UpdateAlertRuleRequestSchema,
} from "./alerts";
import {
  AgentCommandsQuerySchema,
  AgentCommandsResponseSchema,
  AgentStatusResponseSchema,
  CommandResponseSchema,
  CommandResultRequestSchema,
  CommandResultResponseSchema,
  EnrollRequestSchema,
  EnrollResponseSchema,
  EnrollmentCodeResponseSchema,
  RevokeAgentResponseSchema,
  SetAutoPauseResponseSchema,
  SnapshotRequestSchema,
  SnapshotResponseSchema,
} from "./agent";
import {
  CompatResponseSchema,
  PairingApproveRequestSchema,
  PairingApproveResponseSchema,
  PairingLookupRequestSchema,
  PairingLookupResponseSchema,
  PairingPollRequestSchema,
  PairingPollResponseSchema,
  PairingStartRequestSchema,
  PairingStartResponseSchema,
} from "./pairing";
import { DeliveryIngestResponseSchema, DeliverySnapshotSchema, MetricsOverviewSchema, MetricsQuerySchema } from "./metrics";

const scoped = (resource: string) => (serverId: string) =>
  `/api/servers/${encodeURIComponent(serverId)}/${resource}`;

/**
 * One entry per endpoint: the Express route pattern, a path builder for clients, and
 * the response schema both sides validate against (ADR-0002). Entries that take a body
 * also have a `request` schema. The backend doesn't serve the server-scoped, auth or
 * settings routes until those changes land (ADR-0001, 0011, 0012); until then only
 * `health` matches a live route.
 */
export const endpoints = {
  health: { method: "GET", route: "/api/health", path: () => "/api/health", response: HealthResponseSchema },
  // ADR-0025 decision 6: readiness (the database answers), public like health. A 503 body has
  // the same shape, so the response schema is used for both.
  healthReady: {
    method: "GET",
    route: "/api/health/ready",
    path: () => "/api/health/ready",
    response: ReadinessResponseSchema,
  },
  servers: { method: "GET", route: "/api/servers", path: () => "/api/servers", response: ServerListResponseSchema },
  status: {
    method: "GET",
    route: "/api/servers/:serverId/status",
    path: scoped("status"),
    response: StatusResponseSchema,
  },
  factory: {
    method: "GET",
    route: "/api/servers/:serverId/factory",
    path: scoped("factory"),
    response: FactoryResponseSchema,
  },
  // ADR-0048 amendment (#349): the top-N root causes of underfed and backed-up machines, computed on demand from the
  // latest factory snapshot and the conveyors world layer. In the contract before its route (amendment PR 4).
  bottlenecks: {
    method: "GET",
    route: "/api/servers/:serverId/bottlenecks",
    path: scoped("bottlenecks"),
    query: BottlenecksQuerySchema,
    response: BottlenecksResponseSchema,
  },
  // ADR-0050 (production planner): the whole factory as a coarse graph. In the contract before its route (PR 4).
  productionGraph: {
    method: "GET",
    route: "/api/servers/:serverId/production-graph",
    path: scoped("production-graph"),
    response: ProductionGraphResponseSchema,
  },
  // ADR-0055 Decision 5: the player's named sets of buildings. Reads: any member. Writes: the existing member-write guard
  // (403 forbidden for a viewer). In the contract before its routes (PR 9).
  plannerDesignations: {
    list: {
      method: "GET",
      route: "/api/servers/:serverId/planner/designations",
      path: scoped("planner/designations"),
      response: PlannerDesignationsResponseSchema,
    },
    // 201. 409 designation_overlap (with `error.other`) or designation_cap.
    create: {
      method: "POST",
      route: "/api/servers/:serverId/planner/designations",
      path: scoped("planner/designations"),
      request: CreatePlannerDesignationRequestSchema,
      response: PlannerDesignationSchema,
    },
    // 409 designation_overlap (with `error.other`); 404 not_found for an unknown designation.
    update: {
      method: "PUT",
      route: "/api/servers/:serverId/planner/designations/:designationId",
      path: (serverId: string, designationId: string) => `${scoped("planner/designations")(serverId)}/${encodeURIComponent(designationId)}`,
      request: UpdatePlannerDesignationRequestSchema,
      response: PlannerDesignationSchema,
    },
    remove: {
      method: "DELETE",
      route: "/api/servers/:serverId/planner/designations/:designationId",
      path: (serverId: string, designationId: string) => `${scoped("planner/designations")(serverId)}/${encodeURIComponent(designationId)}`,
      response: DeletePlannerDesignationResponseSchema,
    },
    // ADR-0055 Decision 11: merge, split, pop-out, dissolve and undo in one write. 200. 409 designation_stale,
    // designation_overlap (with `error.other`) or designation_cap; 400 bad_request (also a createdAt in the future).
    replace: {
      method: "POST",
      route: "/api/servers/:serverId/planner/designations/replace",
      path: scoped("planner/designations/replace"),
      request: ReplacePlannerDesignationsRequestSchema,
      response: ReplacePlannerDesignationsResponseSchema,
    },
  },
  power: {
    method: "GET",
    route: "/api/servers/:serverId/power",
    path: scoped("power"),
    response: PowerResponseSchema,
  },
  // ADR-0029: who is connected (name and online only), members of the server only.
  players: {
    method: "GET",
    route: "/api/servers/:serverId/players",
    path: scoped("players"),
    response: ServerPlayersResponseSchema,
  },
  // ADR-0022: the last few minutes of power readings, sampled by the backend.
  powerHistory: {
    method: "GET",
    route: "/api/servers/:serverId/power/history",
    path: (serverId: string) => `${scoped("power")(serverId)}/history`,
    response: PowerHistoryResponseSchema,
  },
  // ADR-0027 decision 3: stored history, the range picks the resolution (see history.ts). Query strings are
  // optional (range defaults to 24h); `query` is the schema the backend validates them with.
  history: {
    power: {
      method: "GET",
      route: "/api/servers/:serverId/history/power",
      path: (serverId: string) => `${scoped("history")(serverId)}/power`,
      query: HistoryPowerQuerySchema,
      response: HistoryPowerResponseSchema,
    },
    items: {
      method: "GET",
      route: "/api/servers/:serverId/history/items",
      path: (serverId: string) => `${scoped("history")(serverId)}/items`,
      query: HistoryItemsQuerySchema,
      response: HistoryItemsResponseSchema,
    },
    transitions: {
      method: "GET",
      route: "/api/servers/:serverId/history/transitions",
      path: (serverId: string) => `${scoped("history")(serverId)}/transitions`,
      query: HistoryTransitionsQuerySchema,
      response: HistoryTransitionsResponseSchema,
    },
  },
  // ADR-0038 M3 (#353): the map's world layers (stored, latest only, ETag/304) and mapLive
  // (read-through, ADR-0004). Member-only like every other /api/servers/:serverId route.
  map: {
    worldLayer: {
      method: "GET",
      route: "/api/servers/:serverId/map/world/:layer",
      path: (serverId: string, layer: string) => `${scoped("map/world")(serverId)}/${encodeURIComponent(layer)}`,
      response: MapWorldLayerResponseSchema,
    },
    live: {
      method: "GET",
      route: "/api/servers/:serverId/map/live",
      path: scoped("map/live"),
      response: MapLiveResponseSchema,
    },
  },
  // ADR-0011. Every /api route except health requires the session cookie these set.
  auth: {
    login: {
      method: "POST",
      route: "/api/auth/login",
      path: () => "/api/auth/login",
      request: LoginRequestSchema,
      response: SessionResponseSchema,
    },
    logout: { method: "POST", route: "/api/auth/logout", path: () => "/api/auth/logout", response: SessionResponseSchema },
    // ADR-0025 decision 4: "sign out everywhere". Revokes every session of the signed-in user
    // (this one included) and answers like logout: `authenticated: false`. The admin CLI's
    // revoke-all for everyone is not an HTTP endpoint.
    logoutAll: {
      method: "POST",
      route: "/api/auth/logout-all",
      path: () => "/api/auth/logout-all",
      response: SessionResponseSchema,
    },
    session: { method: "GET", route: "/api/auth/session", path: () => "/api/auth/session", response: SessionResponseSchema },
    // ADR-0025 decision 3: the "Sign in with Google" button is a full-page navigation to this
    // path, optionally with `?return=/app/...`; the answer is a 302, never JSON, so there is no
    // response schema. Offer it only when `signInMethods` includes "google" (Google off = 404).
    googleStart: { method: "GET", route: "/api/auth/google/start", path: () => "/api/auth/google/start" },
  },
  // ADR-0047: the signed-in user deletes their own account. No body; needs a sign-in within the last 10 minutes (403
  // reauth_required), refuses the operator (403 forbidden, reason operator_account) and an owner of an operator-created
  // server (409 would_orphan, reason operator_servers, with `servers`). See account.ts.
  account: {
    remove: {
      method: "DELETE",
      route: "/api/account",
      path: () => "/api/account",
      response: DeleteAccountResponseSchema,
    },
  },
  // ADR-0047: a member leaves a server. Server-scoped (ADR-0001) and open to any MEMBER (`memberSelfService`, viewers
  // included): it removes only the caller's own membership. No body. The owner gets 409 would_orphan, reason last_owner.
  members: {
    leave: {
      method: "POST",
      route: "/api/servers/:serverId/members/me/leave",
      path: scoped("members/me/leave"),
      response: LeaveServerResponseSchema,
      memberSelfService: true,
    },
  },
  // ADR-0030 phase 1: the operator manages the local servers. Every entry is `operatorOnly`: the
  // seeded operator account, not merely an owner or admin (a non-operator answers 403, a non-member
  // of a scoped route 404). Tokens are write-only: requests carry them, responses never do.
  serverManagement: {
    create: {
      method: "POST",
      route: "/api/servers",
      path: () => "/api/servers",
      request: CreateServerRequestSchema,
      response: ServerConnectionResponseSchema,
      operatorOnly: true,
    },
    // Every stored connection, including those the backend is not serving (unreadable or refused).
    // "managed" is a reserved id, so this is never read as a server.
    list: {
      method: "GET",
      route: "/api/servers/managed",
      path: () => "/api/servers/managed",
      response: ManagedServerListResponseSchema,
      operatorOnly: true,
    },
    // Try entered values before saving. Not server-scoped (there is no server yet).
    testConnection: {
      method: "POST",
      route: "/api/servers/test-connection",
      path: () => "/api/servers/test-connection",
      request: TestConnectionRequestSchema,
      response: TestConnectionResponseSchema,
      operatorOnly: true,
    },
    // The stored connection for the edit form: host, ports, token set + last 4.
    get: {
      method: "GET",
      route: "/api/servers/:serverId/connection",
      path: scoped("connection"),
      response: ServerConnectionResponseSchema,
      operatorOnly: true,
    },
    update: {
      method: "PATCH",
      route: "/api/servers/:serverId",
      path: (serverId: string) => `/api/servers/${encodeURIComponent(serverId)}`,
      request: UpdateServerRequestSchema,
      response: ServerConnectionResponseSchema,
      operatorOnly: true,
    },
    // ADR-0031 amendment: an agent server goes back to being read by this backend (the way back from an agent).
    switchToLocal: {
      method: "POST",
      route: "/api/servers/:serverId/local-connection",
      path: scoped("local-connection"),
      request: SwitchToLocalRequestSchema,
      response: ServerConnectionResponseSchema,
      operatorOnly: true,
    },
    // ADR-0031: renames a server reached through an edge agent (it has no stored connection, so `update` cannot).
    renameAgent: {
      method: "PATCH",
      route: "/api/servers/:serverId/name",
      path: scoped("name"),
      request: RenameServerRequestSchema,
      response: RenameServerResponseSchema,
      operatorOnly: true,
      selfServeOwner: true,
    },
    // Removes the server: its memberships, its encrypted tokens and its pollers go.
    remove: {
      method: "DELETE",
      route: "/api/servers/:serverId",
      path: (serverId: string) => `/api/servers/${encodeURIComponent(serverId)}`,
      response: DeleteServerResponseSchema,
      operatorOnly: true,
      selfServeOwner: true,
    },
    // Test the stored connection (the tokens are write-only, so the client cannot resend them).
    testSaved: {
      method: "POST",
      route: "/api/servers/:serverId/test-connection",
      path: scoped("test-connection"),
      response: TestConnectionResponseSchema,
      operatorOnly: true,
    },
  },
  // ADR-0046 (self-serve agent servers): any signed-in user (not `operatorOnly`) creates an agent server and becomes its owner.
  // 201 `{ server }`. Answers 403 `forbidden` while SELF_SERVE_ENABLED is off (the list says so in `selfServeEnabled`).
  // `selfServeOwner` (on `serverManagement.renameAgent` and `.remove` above): the owner of a server created through self-serve
  // (`createdVia: "self_serve"` in the server list) may also call that operator-only route; everyone else still gets 403.
  selfServe: {
    createAgentServer: {
      method: "POST",
      route: "/api/servers/agent",
      path: () => "/api/servers/agent",
      request: CreateAgentServerRequestSchema,
      response: CreateAgentServerResponseSchema,
    },
  },
  // ADR-0027 PR 7 (alerts). Every GET is for any member of the server; every other method (POST .../test included) is
  // owner/admin only. The webhook URL exists only in the PUT request body, never in a response.
  alerts: {
    rules: {
      list: {
        method: "GET",
        route: "/api/servers/:serverId/alerts/rules",
        path: scoped("alerts/rules"),
        response: AlertRulesResponseSchema,
      },
      // 201. Only production_below_target can be created (rule_kind_not_creatable otherwise).
      create: {
        method: "POST",
        route: "/api/servers/:serverId/alerts/rules",
        path: scoped("alerts/rules"),
        request: CreateAlertRuleRequestSchema,
        response: AlertRuleResponseSchema,
      },
      // `item` is immutable (rule_item_immutable).
      update: {
        method: "PATCH",
        route: "/api/servers/:serverId/alerts/rules/:ruleId",
        path: (serverId: string, ruleId: string) => `${scoped("alerts/rules")(serverId)}/${encodeURIComponent(ruleId)}`,
        request: UpdateAlertRuleRequestSchema,
        response: AlertRuleResponseSchema,
      },
      // A preset answers 409 preset_disable_only.
      remove: {
        method: "DELETE",
        route: "/api/servers/:serverId/alerts/rules/:ruleId",
        path: (serverId: string, ruleId: string) => `${scoped("alerts/rules")(serverId)}/${encodeURIComponent(ruleId)}`,
        response: DeleteAlertRuleResponseSchema,
      },
    },
    destinations: {
      get: {
        method: "GET",
        route: "/api/servers/:serverId/alerts/destinations",
        path: scoped("alerts/destinations"),
        response: AlertDestinationsResponseSchema,
      },
      putDiscord: {
        method: "PUT",
        route: "/api/servers/:serverId/alerts/destinations/discord",
        path: scoped("alerts/destinations/discord"),
        request: PutDiscordDestinationRequestSchema,
        response: DiscordDestinationResponseSchema,
      },
      patchDiscord: {
        method: "PATCH",
        route: "/api/servers/:serverId/alerts/destinations/discord",
        path: scoped("alerts/destinations/discord"),
        request: PatchDiscordDestinationRequestSchema,
        response: DiscordDestinationResponseSchema,
      },
      removeDiscord: {
        method: "DELETE",
        route: "/api/servers/:serverId/alerts/destinations/discord",
        path: scoped("alerts/destinations/discord"),
        response: DeleteDestinationResponseSchema,
      },
      // No body. 409 delivery_off while the kill switch is off; 404 destination_not_configured; 429 rate_limited.
      testDiscord: {
        method: "POST",
        route: "/api/servers/:serverId/alerts/destinations/discord/test",
        path: scoped("alerts/destinations/discord/test"),
        response: SendTestResponseSchema,
      },
    },
    events: {
      method: "GET",
      route: "/api/servers/:serverId/alerts/events",
      path: scoped("alerts/events"),
      query: AlertEventsQuerySchema,
      response: AlertEventsResponseSchema,
    },
    status: {
      method: "GET",
      route: "/api/servers/:serverId/alerts/status",
      path: scoped("alerts/status"),
      response: AlertStatusResponseSchema,
    },
    mute: {
      set: {
        method: "PUT",
        route: "/api/servers/:serverId/alerts/mute",
        path: scoped("alerts/mute"),
        request: SetMuteRequestSchema,
        response: MuteSetResponseSchema,
      },
      clear: {
        method: "DELETE",
        route: "/api/servers/:serverId/alerts/mute",
        path: scoped("alerts/mute"),
        response: MuteClearedResponseSchema,
      },
    },
  },
  // ADR-0044 (#348): web push, per USER. The first three are not server-scoped (any signed-in user, own subscriptions only).
  // `optIn` is server-scoped: any MEMBER of the server may read AND write it (`memberSelfService`, viewers included),
  // because it is the member's own notification and no server setting.
  push: {
    config: {
      method: "GET",
      route: "/api/push/config",
      path: () => "/api/push/config",
      response: PushConfigResponseSchema,
    },
    subscribe: {
      method: "POST",
      route: "/api/push/subscriptions",
      path: () => "/api/push/subscriptions",
      request: PushSubscribeRequestSchema,
      response: PushSubscribeResponseSchema, // 201 on a new subscription, 200 on an idempotent repeat
    },
    unsubscribe: {
      method: "DELETE",
      route: "/api/push/subscriptions/:id",
      path: (id: string) => `/api/push/subscriptions/${encodeURIComponent(id)}`,
      response: PushUnsubscribeResponseSchema,
    },
    // No body. 5 per minute per user.
    test: {
      method: "POST",
      route: "/api/push/subscriptions/:id/test",
      path: (id: string) => `/api/push/subscriptions/${encodeURIComponent(id)}/test`,
      response: PushTestResponseSchema,
    },
    optIn: {
      get: {
        method: "GET",
        route: "/api/servers/:serverId/alerts/push",
        path: scoped("alerts/push"),
        response: PushOptInResponseSchema,
      },
      put: {
        method: "PUT",
        route: "/api/servers/:serverId/alerts/push",
        path: scoped("alerts/push"),
        request: PushOptInRequestSchema,
        response: PushOptInResponseSchema,
        memberSelfService: true,
      },
    },
  },
  // ADR-0012.
  settings: {
    get: {
      method: "GET",
      route: "/api/servers/:serverId/settings",
      path: scoped("settings"),
      response: SettingsResponseSchema,
    },
    setAutoPause: {
      method: "PUT",
      route: "/api/servers/:serverId/settings/auto-pause",
      path: scoped("settings/auto-pause"),
      request: SetAutoPauseRequestSchema,
      // ADR-0031 PR 3: today's 200 with the setting, OR (for a server reached through an agent) a 202 with the command
      // to poll. The backend keeps sending 200 until PR 5; a client handles both.
      response: SetAutoPauseResponseSchema,
    },
  },
  // ADR-0031 PR 3, user-facing (members read, owner/admin write): enrolling an agent and seeing what it is doing.
  agent: {
    // 201: a code valid for 10 minutes, single use.
    enrollmentCode: {
      method: "POST",
      route: "/api/servers/:serverId/agent/enrollment-codes",
      path: scoped("agent/enrollment-codes"),
      response: EnrollmentCodeResponseSchema,
    },
    status: {
      method: "GET",
      route: "/api/servers/:serverId/agent",
      path: scoped("agent"),
      response: AgentStatusResponseSchema,
    },
    // The credential stops working at once.
    revoke: {
      method: "DELETE",
      route: "/api/servers/:serverId/agent",
      path: scoped("agent"),
      response: RevokeAgentResponseSchema,
    },
  },
  commands: {
    get: {
      method: "GET",
      route: "/api/servers/:serverId/commands/:commandId",
      path: (serverId: string, commandId: string) => `${scoped("commands")(serverId)}/${encodeURIComponent(commandId)}`,
      response: CommandResponseSchema,
    },
  },
  // ADR-0031 PR 3, the AGENT API: a prefix of its own, NOT under /api/servers, authenticated by the agent's credential
  // (Bearer), so it is outside the membership-based tests. `enroll` is authenticated by the one-time code instead.
  agentApi: {
    enroll: {
      method: "POST",
      route: "/agent/v1/enroll",
      path: () => "/agent/v1/enroll",
      request: EnrollRequestSchema,
      response: EnrollResponseSchema, // 201
    },
    // ADR-0051 section 1 / ADR-0057: device-code pairing, unauthenticated like `enroll`. `startPairing` answers 201; `pollPairing`
    // takes the secret in the BODY (never the URL) and answers 200 pending | expired | slow_down, or 201 approved (enrol's shape).
    startPairing: {
      method: "POST",
      route: "/agent/v1/pairings",
      path: () => "/agent/v1/pairings",
      request: PairingStartRequestSchema,
      response: PairingStartResponseSchema, // 201
    },
    pollPairing: {
      method: "POST",
      route: "/agent/v1/pairings/poll",
      path: () => "/agent/v1/pairings/poll",
      request: PairingPollRequestSchema,
      response: PairingPollResponseSchema,
    },
    snapshots: {
      method: "POST",
      route: "/agent/v1/snapshots",
      path: () => "/agent/v1/snapshots",
      request: SnapshotRequestSchema,
      response: SnapshotResponseSchema,
    },
    // A long-poll: ?waitSeconds=0..25.
    commands: {
      method: "GET",
      route: "/agent/v1/commands",
      path: () => "/agent/v1/commands",
      query: AgentCommandsQuerySchema,
      response: AgentCommandsResponseSchema,
    },
    result: {
      method: "POST",
      route: "/agent/v1/commands/:commandId/result",
      path: (commandId: string) => `/agent/v1/commands/${encodeURIComponent(commandId)}/result`,
      request: CommandResultRequestSchema,
      response: CommandResultResponseSchema,
    },
    // ADR-0038 M3 (#353): one world layer (rails or resourceNodes), gzip-able, capped at
    // MAP_WORLD_LAYER_MAX_BYTES decompressed. No static `request` schema here (it differs per
    // layer, `MAP_WORLD_LAYER_INGEST_SCHEMAS` in map.ts); the route validates by the URL's `:layer`.
    world: {
      method: "POST",
      route: "/agent/v1/world/:layer",
      path: (layer: string) => `/agent/v1/world/${encodeURIComponent(layer)}`,
      response: WorldIngestResponseSchema,
    },
  },
  // ADR-0051 section 1 / ADR-0057: device-code pairing, dashboard side (signed-in user, not server-scoped). Contract only;
  // the codes are typed in, never prefilled from a URL. An unknown, spent or expired code is 404 not_found.
  pairings: {
    lookup: {
      method: "POST",
      route: "/api/pairings/lookup",
      path: () => "/api/pairings/lookup",
      request: PairingLookupRequestSchema,
      response: PairingLookupResponseSchema,
    },
    approve: {
      method: "POST",
      route: "/api/pairings/approve",
      path: () => "/api/pairings/approve",
      request: PairingApproveRequestSchema,
      response: PairingApproveResponseSchema,
    },
  },
  // ADR-0057 Decisions 6 to 8: the version policy for the mod and the agent (signed-in user, read-only).
  compat: { method: "GET", route: "/api/compat", path: () => "/api/compat", response: CompatResponseSchema },
  // ADR-0056 section 2: the operator-only metrics page (not server-scoped). `window` is optional (default 24h).
  metrics: {
    overview: {
      method: "GET",
      route: "/api/admin/metrics",
      path: () => "/api/admin/metrics",
      query: MetricsQuerySchema,
      response: MetricsOverviewSchema,
    },
    // ADR-0056 section 4: the daily delivery snapshot, pushed by a workflow with a bearer secret (not a session).
    deliveryIngest: {
      method: "POST",
      route: "/api/internal/metrics/delivery",
      path: () => "/api/internal/metrics/delivery",
      request: DeliverySnapshotSchema,
      response: DeliveryIngestResponseSchema,
    },
  },
} as const;
