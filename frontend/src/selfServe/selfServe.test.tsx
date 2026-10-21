import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerListResponse, type ServerSummary } from "@satisfactory-dash/shared";
import { agentStatusEnrolled, serversSelfServe } from "@satisfactory-dash/shared/fixtures";
import { SignedInUser } from "../auth/SignedInUser";
import { AgentSettings } from "../agent/AgentSettings";
import { ServerGate } from "../servers/ServerGate";
import { useSelectedServer } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import {
  createdAgentServer,
  errorDailyLimit,
  errorLimitAccount,
  errorLimitPending,
  errorLimitService,
  errorSelfServeOff,
} from "../test/selfServeMocks";
import { server } from "../test/server";
import { YourServersSection } from "./YourServersSection";

const [operatorServer, enrolledServer, pendingServer] = serversSelfServe.servers;
const ADDED: ServerSummary = { id: createdAgentServer.server.id, displayName: "My new world", role: "owner", createdVia: "self_serve", enrolled: false };

/** The list, held in a variable so a write can change what the next read says. */
function serveList(initial: ServerListResponse) {
  const state = { list: initial };
  server.use(http.get(endpoints.servers.route, () => HttpResponse.json(state.list)));
  return state;
}

function Selected() {
  const selected = useSelectedServer();
  return <p>{`selected: ${selected.displayName}`}</p>;
}
function Where() {
  const { pathname, hash } = useLocation();
  return <p data-testid="where">{pathname + hash}</p>;
}

function renderSettings(children = <YourServersSection />) {
  return renderWithClient(
    <MemoryRouter initialEntries={["/app/settings"]}>
      <SignedInUser value={{ name: "Player" }}>
        <ServerGate>
          <Selected />
          {children}
        </ServerGate>
      </SignedInUser>
      <Where />
    </MemoryRouter>,
  );
}

const typeName = (value: string) => fireEvent.change(screen.getByLabelText("Server name"), { target: { value } });
const submitAdd = () => fireEvent.click(screen.getByRole("button", { name: "Add server" }));

describe("Add your server", () => {
  it("is hidden when the list does not say self-serve is on", async () => {
    serveList({ servers: [operatorServer], selfServeEnabled: false });
    renderSettings();
    expect(await screen.findByText("selected: Satisfactory server")).toBeInTheDocument();
    expect(screen.queryByText("Add your server")).not.toBeInTheDocument();
  });

  it("is hidden when an older backend omits the flag", async () => {
    serveList({ servers: [{ id: operatorServer.id, displayName: operatorServer.displayName, role: "viewer" }] });
    renderSettings();
    await screen.findByText("selected: Satisfactory server");
    expect(screen.queryByText("Add your server")).not.toBeInTheDocument();
  });

  it("checks the name with the shared schema before sending anything", async () => {
    serveList({ servers: [operatorServer], selfServeEnabled: true });
    let posts = 0;
    server.use(http.post(endpoints.selfServe.createAgentServer.route, () => ((posts += 1), HttpResponse.json(createdAgentServer, { status: 201 }))));
    renderSettings();
    // One heading only: the section's h3 already says it (no repeated h4 inside).
    expect(await screen.findByRole("heading", { name: "Add your server", level: 3 })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Add your server" })).toHaveLength(1);
    submitAdd();
    expect(await screen.findByText("Enter a name for your server.")).toBeInTheDocument();
    expect(screen.getByLabelText("Server name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Server name")).toHaveFocus();
    typeName("x".repeat(65));
    submitAdd();
    expect(await screen.findByText("Enter a name of up to 64 characters")).toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it("creates the server, selects it and leads to the agent settings", async () => {
    const state = serveList({ servers: [operatorServer], selfServeEnabled: true });
    let body: unknown;
    server.use(
      http.post(endpoints.selfServe.createAgentServer.route, async ({ request }) => {
        body = await request.json();
        state.list = { ...state.list, servers: [...state.list.servers, ADDED] };
        return HttpResponse.json(createdAgentServer, { status: 201 });
      }),
    );
    renderSettings();
    await screen.findByText("selected: Satisfactory server");
    expect(screen.getByText(/works once and lasts 10 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/never connected is removed after 24 hours/)).toBeInTheDocument();
    typeName("  My new world ");
    submitAdd();
    expect(await screen.findByText("selected: My new world")).toBeInTheDocument();
    expect(body).toEqual({ displayName: "My new world" });
    expect(screen.getByTestId("where")).toHaveTextContent("/app/settings#agent");
  });

  it("sends one request for a double click", async () => {
    const state = serveList({ servers: [operatorServer], selfServeEnabled: true });
    let posts = 0;
    server.use(
      http.post(endpoints.selfServe.createAgentServer.route, () => {
        posts += 1;
        state.list = { ...state.list, servers: [...state.list.servers, ADDED] };
        return HttpResponse.json(createdAgentServer, { status: 201 });
      }),
    );
    renderSettings();
    await screen.findByText("selected: Satisfactory server");
    typeName("My new world");
    submitAdd();
    submitAdd();
    submitAdd();
    await screen.findByText("selected: My new world");
    expect(posts).toBe(1);
  });

  it.each([
    ["C1, the account's limit", errorLimitAccount, 409, undefined, /You already have 2 server\(s\); one account can have at most 2/],
    ["C3, a pending server first", errorLimitPending, 409, undefined, /Connect your server "My new world" with its enrolment code/],
    ["C2, the service is full", errorLimitService, 409, undefined, /The service is full right now/],
    ["C5, the daily limit, with when to retry", errorDailyLimit, 429, "18000", /Try again in about 5 hours\./],
    ["self-serve switched off", errorSelfServeOff, 403, undefined, /isn't available right now/],
  ])("shows a clear message for %s", async (_name, envelope, status, retryAfter, message) => {
    serveList({ servers: [operatorServer], selfServeEnabled: true });
    server.use(
      http.post(endpoints.selfServe.createAgentServer.route, () =>
        HttpResponse.json(envelope, { status, headers: retryAfter ? { "Retry-After": retryAfter } : undefined }),
      ),
    );
    renderSettings();
    await screen.findByText("selected: Satisfactory server");
    typeName("Another");
    submitAdd();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    // The form stays, so the player can fix the name or try later; nothing was selected.
    expect(screen.getByLabelText("Server name")).toHaveValue("Another");
    expect(screen.getByText("selected: Satisfactory server")).toBeInTheDocument();
  });

  it("falls back to the generic notice (with the request id) for any other failure", async () => {
    serveList({ servers: [operatorServer], selfServeEnabled: true });
    server.use(
      http.post(endpoints.selfServe.createAgentServer.route, () =>
        HttpResponse.json({ error: { code: "internal_error", message: "Something broke", requestId: "req-529" } }, { status: 500 }),
      ),
    );
    renderSettings();
    await screen.findByText("selected: Satisfactory server");
    typeName("Another");
    submitAdd();
    expect(await screen.findByText("Something broke")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-529")).toBeInTheDocument();
  });

  it("is the whole screen for a player with no server yet, and selects the new one", async () => {
    const state = serveList({ servers: [], selfServeEnabled: true });
    server.use(
      http.post(endpoints.selfServe.createAgentServer.route, () => {
        state.list = { servers: [ADDED], selfServeEnabled: true };
        return HttpResponse.json(createdAgentServer, { status: 201 });
      }),
    );
    renderSettings();
    expect(await screen.findByRole("heading", { name: "Add your first server", level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/Name it, get a code, paste it on the game PC/)).toBeInTheDocument();
    expect(screen.getByLabelText("Server name")).toHaveAttribute("placeholder", "e.g. Our factory");
    // No shell here, so the account menu is: a signed-in player can always sign out.
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    typeName("My new world");
    submitAdd();
    expect(await screen.findByText("selected: My new world")).toBeInTheDocument();
  });

  it("with self-serve off and no server, still only says none are configured", async () => {
    serveList({ servers: [], selfServeEnabled: false });
    renderSettings();
    expect(await screen.findByText("No game servers are configured.")).toBeInTheDocument();
  });
});

describe("the owner's controls", () => {
  it("are offered to the owner of a self_serve server, and to nobody else", async () => {
    serveList({ servers: [{ ...enrolledServer, role: "admin" }], selfServeEnabled: false });
    const admin = renderSettings();
    await screen.findByText(/selected: My first world/);
    expect(screen.queryByRole("button", { name: /^Rename/ })).not.toBeInTheDocument();
    admin.unmount();

    serveList({ servers: [{ ...operatorServer, role: "owner" }], selfServeEnabled: false });
    const operatorOwned = renderSettings();
    await screen.findByText("selected: Satisfactory server");
    expect(screen.queryByRole("button", { name: /^Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
    operatorOwned.unmount();

    serveList({ servers: [enrolledServer], selfServeEnabled: false });
    renderSettings();
    expect(await screen.findByRole("button", { name: "Rename My first world" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove My first world from Satisfactory Dash" })).toBeInTheDocument();
  });

  it("tells the owner of a never-enrolled server it is removed after 24 hours", async () => {
    serveList({ servers: [pendingServer], selfServeEnabled: false });
    renderSettings();
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent(/Create an enrolment code above to connect it/);
    expect(note).toHaveTextContent(/within 24 hours of adding it is removed automatically/);
    expect(screen.getByRole("link", { name: "Create an enrolment code above" })).toHaveAttribute("href", "/app/settings#agent");
    // Name and status, like the agent panel.
    expect(screen.getByText("Waiting for first connection")).toBeInTheDocument();
  });

  it("has no such notice once enrolled", async () => {
    serveList({ servers: [enrolledServer], selfServeEnabled: false });
    renderSettings();
    await screen.findByRole("button", { name: "Rename My first world" });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("drops the notice when the agent status already says enrolled, though the list is behind", async () => {
    serveList({ servers: [pendingServer], selfServeEnabled: false });
    server.use(http.get(endpoints.agent.status.route, () => HttpResponse.json(agentStatusEnrolled)));
    renderSettings();
    await screen.findByRole("button", { name: "Rename My new world" });
    await waitFor(() => expect(screen.queryByRole("note")).not.toBeInTheDocument());
  });

  it("renames with the shared name rules and shows the new name", async () => {
    const state = serveList({ servers: [enrolledServer], selfServeEnabled: false });
    let body: unknown;
    server.use(
      http.patch(endpoints.serverManagement.renameAgent.route, async ({ request }) => {
        body = await request.json();
        state.list = { ...state.list, servers: [{ ...enrolledServer, displayName: "Renamed" }] };
        return HttpResponse.json({ server: { id: enrolledServer.id, displayName: "Renamed", kind: "agent" } });
      }),
    );
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Rename My first world" }));
    const field = screen.getByLabelText("New server name");
    expect(field).toHaveValue("My first world");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Enter a name for your server.")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("selected: Renamed")).toBeInTheDocument();
    expect(body).toEqual({ displayName: "Renamed" });
    // Back to the buttons, focus on the one that opened the form.
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename Renamed" })).toHaveFocus());
  });

  it("says so when a rename is refused", async () => {
    serveList({ servers: [enrolledServer], selfServeEnabled: false });
    server.use(
      http.patch(endpoints.serverManagement.renameAgent.route, () =>
        HttpResponse.json({ error: { code: "forbidden", message: "no", requestId: "r" } }, { status: 403 }),
      ),
    );
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Rename My first world" }));
    fireEvent.change(screen.getByLabelText("New server name"), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Only the owner of a server you added can do that.")).toBeInTheDocument();
  });

  it("asks for the server's name before deleting, and says what is deleted", async () => {
    const state = serveList({ servers: [enrolledServer], selfServeEnabled: false });
    let deletes = 0;
    server.use(
      http.delete(endpoints.serverManagement.remove.route, () => {
        deletes += 1;
        state.list = { servers: [] };
        return HttpResponse.json({ deleted: true });
      }),
    );
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Remove My first world from Satisfactory Dash" }));
    const group = screen.getByRole("form", { name: "Confirm removing My first world from Satisfactory Dash" });
    expect(group).toHaveTextContent(/Removing takes this server off Satisfactory Dash for good/);
    expect(group).toHaveTextContent(/Its history and alerts/);
    expect(group).toHaveTextContent(/Its push settings and members/);
    expect(group).toHaveTextContent(/This can't be undone./);
    expect(group).toHaveTextContent(/Your game and its saves are never touched: nothing on your game PC changes./);
    // ADR-0047 amendment: a server is removed from Satisfactory Dash, never "deleted".
    expect(group).not.toHaveTextContent(/delet/i);
    expect(group).toHaveTextContent(/must match exactly, capital letters included/);
    expect(screen.getByLabelText(/Type My first world to confirm/)).toHaveAccessibleDescription(expect.stringContaining("must match exactly"));
    const confirm = screen.getByRole("button", { name: "Remove from Satisfactory Dash" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type My first world to confirm/), { target: { value: "My first" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type My first world to confirm/), { target: { value: "My first world" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    // The server is gone from the list: the gate has nothing to select.
    expect(await screen.findByText("No game servers are configured.")).toBeInTheDocument();
    expect(deletes).toBe(1);
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  });

  it("cancels the confirmation and returns focus to the button that opened it", async () => {
    serveList({ servers: [enrolledServer], selfServeEnabled: false });
    let deletes = 0;
    server.use(http.delete(endpoints.serverManagement.remove.route, () => ((deletes += 1), HttpResponse.json({ deleted: true }))));
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Remove My first world from Satisfactory Dash" }));
    expect(screen.getByText(/Removing takes this server off/).parentElement).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove My first world from Satisfactory Dash" })).toHaveFocus());
    expect(deletes).toBe(0);
  });

  it("shows a refused delete and keeps the server", async () => {
    serveList({ servers: [enrolledServer], selfServeEnabled: false });
    server.use(
      http.delete(endpoints.serverManagement.remove.route, () =>
        HttpResponse.json({ error: { code: "forbidden", message: "no", requestId: "r" } }, { status: 403 }),
      ),
    );
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Remove My first world from Satisfactory Dash" }));
    fireEvent.change(screen.getByLabelText(/Type My first world to confirm/), { target: { value: "My first world" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove from Satisfactory Dash" }));
    expect(await screen.findByText("Only the owner of a server you added can do that.")).toBeInTheDocument();
    expect(screen.getByText("selected: My first world")).toBeInTheDocument();
  });
});

describe("the enrolment instructions", () => {
  const renderAgent = () =>
    renderWithClient(
      <MemoryRouter>
        <ServerGate>
          <AgentSettings />
        </ServerGate>
      </MemoryRouter>,
    );

  it("tell the owner of a self_serve server where the mod reads the code, and how long it lasts", async () => {
    serveList({ servers: [pendingServer], selfServeEnabled: true });
    server.use(
      http.get(endpoints.agent.status.route, () =>
        HttpResponse.json({ enrolled: false, connectionKind: "agent", lastSeenAt: null, agentVersion: null }),
      ),
    );
    renderAgent();
    const guide = (await screen.findByText("Connect your game server")).closest("details")!;
    expect(guide).toHaveAttribute("open"); // prominent while pending
    expect(screen.getByText("FactoryGame/Configs/SatisDashAgent.cfg")).toBeInTheDocument();
    expect(screen.getByText("enrollmentCode")).toBeInTheDocument();
    expect(screen.getByText(/12 characters, works once and lasts 10 minutes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create enrolment code" })).toBeInTheDocument();
  });

  it("are not shown for an operator's server", async () => {
    serveList({ servers: [operatorServer], selfServeEnabled: true });
    renderAgent();
    await screen.findByText("Game PC agent");
    await screen.findByText(/Reached/);
    expect(screen.queryByText("Connect your game server")).not.toBeInTheDocument();
  });
});
