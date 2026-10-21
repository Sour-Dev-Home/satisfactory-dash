import type { ApiErrorResponse, CreateAgentServerResponse, ServerListResponse } from "@satisfactory-dash/shared";
import { serversSelfServe } from "@satisfactory-dash/shared/fixtures";

// ADR-0046 mocks for the self-serve screens (#529), shared by the unit handlers and the scenarios.

/** What POST /api/servers/agent answers (201): the new agent server. */
export const createdAgentServer = {
  server: { id: "my-new-world", displayName: "My new world", kind: "agent" },
} satisfies CreateAgentServerResponse;

const [operatorServer, enrolledServer, pendingServer] = serversSelfServe.servers;

/** A list of one server (the Settings page needs a selected one), with self-serve on or off. */
const single = (server: ServerListResponse["servers"][number], selfServeEnabled: boolean): ServerListResponse => ({
  servers: [server],
  selfServeEnabled,
});

/** A player who views the operator's server; self-serve is on, so Settings offers "Add your server". */
export const listSelfServeOn = single(operatorServer, true);
/** The same player with self-serve switched off: no "Add your server". */
export const listSelfServeOff = single(operatorServer, false);
/** Nothing to select yet and self-serve on: the add form is the whole screen. */
export const listSelfServeEmpty = { servers: [], selfServeEnabled: true } satisfies ServerListResponse;
/** The owner of an enrolled self-serve server (rename and delete). */
export const listOwnsEnrolled = single(enrolledServer, true);
/** The owner of a self-serve server that has not enrolled yet (the 24 hour notice). */
export const listOwnsPending = single(pendingServer, true);

const envelope = (code: string, message: string, requestId: string): ApiErrorResponse => ({ error: { code, message, requestId } });

/** C1: the account already has the most servers allowed. */
export const errorLimitAccount = envelope(
  "server_limit_reached",
  "You already have 2 server(s); one account can have at most 2. Remove one to add another.",
  "00000000-0000-4000-8000-000000000521",
);
/** C3: an earlier server is still waiting to be connected. */
export const errorLimitPending = envelope(
  "server_limit_reached",
  'Connect your server "My new world" with its enrolment code before adding another.',
  "00000000-0000-4000-8000-000000000522",
);
/** C2: the whole service is full. */
export const errorLimitService = envelope(
  "server_limit_reached",
  "The service is full right now: no new servers can be added. Try again later.",
  "00000000-0000-4000-8000-000000000523",
);
/** C5: too many creations in a day (the answer carries Retry-After). */
export const errorDailyLimit = envelope(
  "rate_limited",
  "You have added the most servers allowed in one day. Try again tomorrow.",
  "00000000-0000-4000-8000-000000000524",
);
/** Self-serve switched off between the list and the click. */
export const errorSelfServeOff = envelope("forbidden", "Forbidden", "00000000-0000-4000-8000-000000000525");
