import { fireEvent, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerListResponse } from "@satisfactory-dash/shared";
import {
  deleteServerDone,
  errorServerNotFound,
  errorUpstreamUnreachable,
  serversMultiple,
  serversNone,
  serversSingle,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { ServerManagementView } from "../serverManagement/ServerManagementView";
import { managedAgentNone } from "../test/managedMocks";
import { renderWithClient } from "../test/render";
import { createdAgentServer } from "../test/selfServeMocks";
import { server } from "../test/server";
import { useSelectedServer } from "./ServerContext";
import { ServerGate } from "./ServerGate";
import { ServerSwitcher } from "./ServerSwitcher";

/** Stands in for the views: polls status for the selected server. */
function SelectedStatus() {
  const selected = useSelectedServer();
  const status = useQuery(queries.status(selected.id));
  return <p>{status.data ? `status for ${status.data.serverId}` : "loading status"}</p>;
}

/** Like the shell: the switcher renders inside the gate. */
function renderGate() {
  return renderWithClient(
    <ServerGate>
      <ServerSwitcher />
      <SelectedStatus />
    </ServerGate>,
  );
}

function listServers(list: ServerListResponse) {
  server.use(http.get(endpoints.servers.route, () => HttpResponse.json(list)));
}

describe("ServerGate", () => {
  it("shows a status while discovering servers", async () => {
    server.use(
      http.get(endpoints.servers.route, async () => {
        await delay(50);
        return HttpResponse.json(serversSingle);
      }),
    );
    renderGate();
    expect(screen.getByRole("status")).toHaveTextContent("Finding game servers");
    expect(await screen.findByText("status for default")).toBeInTheDocument();
  });

  it("auto-selects the only server", async () => {
    renderGate();
    expect(await screen.findByText("Satisfactory server")).toBeInTheDocument();
    expect(await screen.findByText("status for default")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change server" })).not.toBeInTheDocument();
  });

  it("shows a picker when there are several servers, and switches on request", async () => {
    listServers(serversMultiple);
    server.use(
      http.get(endpoints.status.route, ({ params }) =>
        HttpResponse.json({ ...statusRunning, serverId: String(params.serverId) }),
      ),
    );
    renderGate();
    expect(await screen.findByRole("heading", { name: "Choose a game server" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Creative test world" }));
    expect(await screen.findByText("status for creative-test")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change server" }));
    fireEvent.click(await screen.findByRole("button", { name: "Satisfactory server" }));
    expect(await screen.findByText("status for default")).toBeInTheDocument();
  });

  it("says so when no servers are configured", async () => {
    listServers(serversNone);
    renderGate();
    expect(await screen.findByText("No game servers are configured.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a server" })).not.toBeInTheDocument();
  });

  it("shows the operator the managed list instead (ADR-0030), with no direct-poll Add a server (ADR-0066)", async () => {
    listServers({ ...serversNone, canManageServers: true });
    renderGate();
    expect(await screen.findByRole("heading", { name: "Set up a game server" })).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Game servers" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a server" })).not.toBeInTheDocument();
    // Self-serve is off in this list, so there is no "Add your server" either.
    expect(screen.queryByRole("button", { name: "Add server" })).not.toBeInTheDocument();
    expect(screen.queryByText("No game servers are configured.")).not.toBeInTheDocument();
  });

  it("shows an error with a retry when discovery fails", async () => {
    let fail = true;
    server.use(
      http.get(endpoints.servers.route, () =>
        fail ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(serversSingle),
      ),
    );
    renderGate();
    expect(await screen.findByRole("alert")).toHaveAttribute("data-request-id", errorUpstreamUnreachable.error.requestId);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("status for default")).toBeInTheDocument();
  });

  it("re-runs discovery on server_not_found and shows the picker instead of looping", async () => {
    let listCalls = 0;
    let statusCalls = 0;
    server.use(
      http.get(endpoints.servers.route, () => {
        listCalls++;
        return HttpResponse.json(serversSingle);
      }),
      http.get(endpoints.status.route, () => {
        statusCalls++;
        return HttpResponse.json(errorServerNotFound, { status: 404 });
      }),
    );
    renderGate();
    expect(await screen.findByText("The selected server is no longer available.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose a game server" })).toBeInTheDocument();

    await delay(100);
    expect(listCalls).toBe(2);
    expect(statusCalls).toBe(1);
  });

  it("moves from the empty state into the app once the operator adds the first server with Add your server", async () => {
    let added = false;
    const created = { ...serversSingle.servers[0], id: createdAgentServer.server.id, displayName: createdAgentServer.server.displayName };
    server.use(
      http.get(endpoints.servers.route, () =>
        HttpResponse.json(
          added
            ? { servers: [created], canManageServers: true, selfServeEnabled: true }
            : { ...serversNone, canManageServers: true, selfServeEnabled: true },
        ),
      ),
      http.get(endpoints.serverManagement.list.route, () => HttpResponse.json(managedAgentNone)),
      http.post(endpoints.selfServe.createAgentServer.route, () => {
        added = true;
        return HttpResponse.json(createdAgentServer, { status: 201 });
      }),
      http.get(endpoints.status.route, ({ params }) => HttpResponse.json({ ...statusRunning, serverId: String(params.serverId) })),
    );
    // Add your server goes on to Settings, so this one needs a router.
    renderWithClient(
      <MemoryRouter>
        <ServerGate>
          <ServerSwitcher />
          <SelectedStatus />
        </ServerGate>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No game servers yet\./)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Server name"), { target: { value: createdAgentServer.server.displayName } });
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    // The empty-state screen is replaced by the normal app once the server list refetches with the new server.
    expect(await screen.findByText(`status for ${createdAgentServer.server.id}`)).toBeInTheDocument();
  });

  it("falls back to the empty state after the operator removes the last server (ADR-0030)", async () => {
    let removed = false;
    server.use(
      http.get(endpoints.servers.route, () =>
        HttpResponse.json(removed ? { ...serversNone, canManageServers: true } : { ...serversSingle, canManageServers: true }),
      ),
      http.get(endpoints.serverManagement.list.route, () =>
        HttpResponse.json(
          removed
            ? managedAgentNone
            : { servers: [], agentServers: [{ id: serversSingle.servers[0].id, displayName: serversSingle.servers[0].displayName, kind: "agent" }] },
        ),
      ),
      http.delete(endpoints.serverManagement.remove.route, () => {
        removed = true;
        return HttpResponse.json(deleteServerDone);
      }),
    );
    renderWithClient(
      <ServerGate>
        <ServerManagementView />
      </ServerGate>,
    );
    // The row's opener names its server (#305); the confirm below is "Remove server".
    fireEvent.click(await screen.findByRole("button", { name: /^Remove (?!server$)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove server" }));
    // The whole gate swaps to the empty-state screen: the management view that showed "Removed
    // ..." a moment ago is gone, unmounted along with the rest of the app.
    expect(await screen.findByRole("heading", { name: "Set up a game server" })).toBeInTheDocument();
  });

  it("lets the operator pick a lost server again explicitly", async () => {
    let missing = true;
    server.use(
      http.get(endpoints.status.route, () =>
        missing ? HttpResponse.json(errorServerNotFound, { status: 404 }) : HttpResponse.json(statusRunning),
      ),
    );
    renderGate();
    await screen.findByText("The selected server is no longer available.");
    missing = false;
    fireEvent.click(screen.getByRole("button", { name: "Satisfactory server" }));
    expect(await screen.findByText("status for default")).toBeInTheDocument();
  });
});
