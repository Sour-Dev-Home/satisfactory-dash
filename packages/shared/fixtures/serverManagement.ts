import type {
  ApiErrorResponse,
  DeleteServerResponse,
  ManagedServerListResponse,
  ServerConnection,
  ServerConnectionResponse,
  ServerListResponse,
  TestConnectionResponse,
} from "../src/index";

// ADR-0030: managing servers (operator only). Invented values only: fake ids, fake token suffixes, and hosts limited
// to 127.0.0.1 and RFC 1918 examples. Tokens never appear in any response, so none appears here.

// --- the members' list, with the operator flag (GET /api/servers) ---------------------------------------------------

/** The operator: `canManageServers` is true, so the screen offers add, edit and remove. */
export const serversOperator = {
  servers: [
    { id: "default", displayName: "Satisfactory server" },
    { id: "creative-test", displayName: "Creative test world" },
  ],
  canManageServers: true,
} satisfies ServerListResponse;

/** A member who is not the operator: the flag is false (a backend from before ADR-0030 omits it, and means the same). */
export const serversMemberCannotManage = {
  servers: [{ id: "default", displayName: "Satisfactory server" }],
  canManageServers: false,
} satisfies ServerListResponse;

// --- one stored connection (GET .../connection, POST /api/servers, PATCH /api/servers/:serverId) ---------------------

const connectionOk = {
  id: "default",
  displayName: "Satisfactory server",
  host: "127.0.0.1",
  apiPort: 7777,
  frmPort: 8080,
  apiTokenSet: true,
  apiTokenLast4: "1a2b",
  frmTokenSet: true,
  frmTokenLast4: "3c4d",
  state: "ok",
  plainHttpOverLan: false,
} satisfies ServerConnection;

/** A loopback server with both tokens set: only the last 4 characters are ever shown. */
export const serverConnectionOk = { server: connectionOk } satisfies ServerConnectionResponse;

/** FRM runs without a token here (`frmTokenSet: false`, no suffix). */
export const serverConnectionNoFrmToken = {
  server: { ...connectionOk, frmTokenSet: false, frmTokenLast4: null },
} satisfies ServerConnectionResponse;

// --- the operator's list of every stored connection (GET /api/servers/managed) -----------------------------------------

/** All three states: ok, unreadable (tokens cannot be opened; host and ports still shown, no suffixes) and refused
 *  (a stored address the backend will not connect to; `plainHttpOverLan` true because it is not loopback). */
export const managedServersAllStates = {
  servers: [
    connectionOk,
    {
      id: "creative-test",
      displayName: "Creative test world",
      host: "127.0.0.1",
      apiPort: 7778,
      frmPort: 8081,
      apiTokenSet: true,
      apiTokenLast4: null,
      frmTokenSet: true,
      frmTokenLast4: null,
      state: "unreadable",
      plainHttpOverLan: false,
    },
    {
      id: "friends-2",
      displayName: "Friends' save",
      host: "192.168.1.20",
      apiPort: 7777,
      frmPort: 8080,
      apiTokenSet: true,
      apiTokenLast4: null,
      frmTokenSet: false,
      frmTokenLast4: null,
      state: "refused",
      plainHttpOverLan: true,
    },
  ],
} satisfies ManagedServerListResponse;

export const managedServersEmpty = { servers: [] } satisfies ManagedServerListResponse;

/** ADR-0031: one polled server and one reached through an edge agent, which has no connection fields and only a name to edit. */
export const managedServersWithAgent = {
  servers: [connectionOk],
  agentServers: [{ id: "factory-two", displayName: "Factory two", kind: "agent" }],
} satisfies ManagedServerListResponse;

/** PATCH /api/servers/:serverId/name */
export const renameAgentServerRequest = { displayName: "Factory two (renamed)" };
export const renameAgentServerResponse = { server: { id: "factory-two", displayName: "Factory two (renamed)", kind: "agent" } };

// --- test connection (POST /api/servers/test-connection and /api/servers/:serverId/test-connection) ---------------------

export const testConnectionPassed = { ok: true, api: { ok: true }, frm: { ok: true } } satisfies TestConnectionResponse;

/** The API token was rejected: the vanilla API answered 401 or 403. */
export const testConnectionApiUnauthorized = {
  ok: false,
  api: { ok: false, error: "unauthorized" },
  frm: { ok: true },
} satisfies TestConnectionResponse;

/** FRM did not answer (not running, wrong port, or a firewall). */
export const testConnectionFrmUnreachable = {
  ok: false,
  api: { ok: true },
  frm: { ok: false, error: "unreachable" },
} satisfies TestConnectionResponse;

/** The port answers, but not with what the vanilla API returns (something else is listening there). */
export const testConnectionApiInvalidResponse = {
  ok: false,
  api: { ok: false, error: "invalid_response" },
  frm: { ok: true },
} satisfies TestConnectionResponse;

// --- remove (DELETE /api/servers/:serverId) ------------------------------------------------------------------------------

export const deleteServerDone = { deleted: true } satisfies DeleteServerResponse;

// --- error envelopes for the management routes ---------------------------------------------------------------------------

/** 403: a member who is not the operator (an owner or admin included). Never a 404 here: they can already see the server. */
export const errorOperatorOnly = {
  error: {
    code: "forbidden",
    message: "Only the operator can manage servers.",
    requestId: "00000000-0000-4000-8000-000000000021",
  },
} satisfies ApiErrorResponse;

/** 400: the request body failed its schema. The message names fields, never values (a token may be among them). */
export const errorValidation = {
  error: {
    code: "bad_request",
    message: "Invalid request: apiPort: Too big: expected number to be <=65535; host: Enter a hostname or an IP address only (no scheme, port or path)",
    requestId: "00000000-0000-4000-8000-000000000022",
    detail: "Only present in development and test.",
  },
} satisfies ApiErrorResponse;

/** 409: servers still come from the environment and none is stored, so adding one would drop them at the next restart. */
export const errorImportRequired = {
  error: {
    code: "import_required",
    message:
      "Servers are still configured in the environment and none is stored yet. Import them first (npm run admin -- import-servers; see the servers runbook) or remove those variables, then add more.",
    requestId: "00000000-0000-4000-8000-000000000023",
  },
} satisfies ApiErrorResponse;

/** 422: ADR-0030 amendment 1. Only loopback servers can be used until certificate pinning exists. Never names the address. */
export const errorLanRequiresCertPinning = {
  error: {
    code: "lan_requires_cert_pinning",
    message: "Only loopback servers can be used for now: LAN servers wait for certificate pinning (ADR-0030, amendment 1).",
    requestId: "00000000-0000-4000-8000-000000000024",
  },
} satisfies ApiErrorResponse;

/** 422: the host is not a loopback or private address, or did not resolve. Never names the address. */
export const errorAddressNotAllowed = {
  error: {
    code: "address_not_allowed",
    message: "That host is not a loopback or private (LAN) address, or it could not be resolved.",
    requestId: "00000000-0000-4000-8000-000000000025",
  },
} satisfies ApiErrorResponse;

/** 422: the game server did not pass the connection test, so nothing was saved. Codes only. */
export const errorConnectionTestFailed = {
  error: {
    code: "connection_test_failed",
    message: "The game server did not pass the connection test (API: unauthorized, FRM: ok). Nothing was saved.",
    requestId: "00000000-0000-4000-8000-000000000026",
  },
} satisfies ApiErrorResponse;

/** 409: the stored tokens cannot be opened with this backend's key; send both tokens again (the FRM token may be null). */
export const errorConnectionUnreadable = {
  error: {
    code: "connection_unreadable",
    message: "The stored tokens cannot be read with this backend's key. Send both tokens again (the FRM token may be null).",
    requestId: "00000000-0000-4000-8000-000000000027",
  },
} satisfies ApiErrorResponse;

/** 409: that id is taken. */
export const errorServerExists = {
  error: {
    code: "server_exists",
    message: "A server with that id already exists.",
    requestId: "00000000-0000-4000-8000-000000000028",
  },
} satisfies ApiErrorResponse;

/** 409: the cap of 8 servers is reached. */
export const errorServerLimitReached = {
  error: {
    code: "server_limit_reached",
    message: "At most 8 servers can be added.",
    requestId: "00000000-0000-4000-8000-000000000029",
  },
} satisfies ApiErrorResponse;
