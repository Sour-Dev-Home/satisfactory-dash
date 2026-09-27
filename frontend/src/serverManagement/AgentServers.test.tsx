import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorConnectionTestFailed,
  errorServerNotAgent,
  managedServersWithAgent,
  renameAgentServerResponse,
  serverConnectionOk,
  switchToLocalRequest,
} from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { ServerManagementView } from "./ServerManagementView";

// ADR-0031: servers read through the game PC's agent, on the operator's Servers page. #266: listed,
// with a rename. #273: "Switch back to local", the way back from an agent.

const agentServer = managedServersWithAgent.agentServers[0];

function withAgentServer() {
  server.use(http.get(endpoints.serverManagement.list.route, () => HttpResponse.json(managedServersWithAgent)));
}

/** Records every body sent to a route and answers with `reply`. */
function capture(method: "post" | "patch", route: string, reply: () => Response) {
  const bodies: unknown[] = [];
  server.use(
    http[method](route, async ({ request }) => {
      bodies.push(await request.json());
      return reply();
    }),
  );
  return bodies;
}

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function openSwitch() {
  withAgentServer();
  const view = renderWithClient(<ServerManagementView />);
  fireEvent.click(await screen.findByRole("button", { name: `Switch back to local for ${agentServer.displayName}` }));
  return view;
}

function fillConnection() {
  type("Host", switchToLocalRequest.host);
  type("Game API port", String(switchToLocalRequest.apiPort));
  type("FRM port", String(switchToLocalRequest.frmPort));
  type("Game API token", switchToLocalRequest.apiToken);
}

describe("ServerManagementView: servers read through an agent", () => {
  it("lists them apart from stored connections, each with Rename and Switch back to local", async () => {
    withAgentServer();
    renderWithClient(<ServerManagementView />);
    const list = await screen.findByRole("list", { name: "Servers read through an agent" });
    const item = within(list).getByRole("listitem", { name: agentServer.displayName });
    expect(within(item).getByText(/read through the game PC's agent/)).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: `Rename ${agentServer.displayName}` })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Game servers" })).toBeInTheDocument();
  });

  it("isn't 'no servers yet' when the only servers are agent servers", async () => {
    server.use(
      http.get(endpoints.serverManagement.list.route, () =>
        HttpResponse.json({ servers: [], agentServers: managedServersWithAgent.agentServers }),
      ),
    );
    renderWithClient(<ServerManagementView />);
    expect(await screen.findByRole("list", { name: "Servers read through an agent" })).toBeInTheDocument();
    expect(screen.queryByText(/No game servers yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Game servers" })).not.toBeInTheDocument();
  });

  it("renames one through its own route, with only the name", async () => {
    withAgentServer();
    const bodies = capture("patch", endpoints.serverManagement.renameAgent.route, () =>
      HttpResponse.json(renameAgentServerResponse),
    );
    renderWithClient(<ServerManagementView />);
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${agentServer.displayName}` }));
    expect(screen.getByRole("heading", { name: `Rename server: ${agentServer.displayName}` })).toBeInTheDocument();
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    type("Name", renameAgentServerResponse.server.displayName);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(`Saved ${renameAgentServerResponse.server.displayName}.`)).toBeInTheDocument();
    expect(bodies).toEqual([{ displayName: renameAgentServerResponse.server.displayName }]);
  });

  it("says why a new name is refused, and sends nothing", async () => {
    withAgentServer();
    const bodies = capture("patch", endpoints.serverManagement.renameAgent.route, () =>
      HttpResponse.json(renameAgentServerResponse),
    );
    renderWithClient(<ServerManagementView />);
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${agentServer.displayName}` }));
    type("Name", "Two​worlds");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/^A name is printable text/)).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  // The rename/renameAgent branches share one line in bodyFor (ServerForm.tsx): a plain "rename"
  // already has "nothing to change" coverage (ServerManagementView.test.tsx); this is the same
  // check for the agent branch of that shared line, so the refactor can't quietly diverge them.
  it("says nothing to change when the name is unchanged, and sends nothing", async () => {
    withAgentServer();
    const bodies = capture("patch", endpoints.serverManagement.renameAgent.route, () =>
      HttpResponse.json(renameAgentServerResponse),
    );
    renderWithClient(<ServerManagementView />);
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${agentServer.displayName}` }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Nothing to change.")).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });
});

describe("ServerManagementView: switching an agent server back to local (#273)", () => {
  it("explains what switching does, then sends the connection and says to stop the agent", async () => {
    const bodies = capture("post", endpoints.serverManagement.switchToLocal.route, () =>
      HttpResponse.json({ server: { ...serverConnectionOk.server, id: agentServer.id, displayName: agentServer.displayName } }),
    );
    await openSwitch();
    expect(
      screen.getByRole("heading", { name: `Switch back to reading the server directly: ${agentServer.displayName}` }),
    ).toBeInTheDocument();
    expect(screen.getByText(/tested first and nothing changes if it fails/)).toBeInTheDocument();
    // Only the connection: the id and the name are the server's own.
    expect(screen.queryByLabelText("Server id")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Test and switch back" }));
    expect(await screen.findByText(/is read directly again, and its agent is revoked\. Stop the agent on the game PC/)).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        host: switchToLocalRequest.host,
        apiPort: switchToLocalRequest.apiPort,
        frmPort: switchToLocalRequest.frmPort,
        apiToken: switchToLocalRequest.apiToken,
      },
    ]);
  });

  it("offers Test connection before switching, with the same connection the switch itself sends", async () => {
    const testBodies = capture("post", endpoints.serverManagement.testConnection.route, () =>
      HttpResponse.json({ ok: true, api: { ok: true }, frm: { ok: true } }),
    );
    await openSwitch();
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(testBodies.length).toBe(1));
    // Only the connection: no id or name field exists on this form to leak into the test body.
    expect(testBodies).toEqual([
      {
        host: switchToLocalRequest.host,
        apiPort: switchToLocalRequest.apiPort,
        frmPort: switchToLocalRequest.frmPort,
        apiToken: switchToLocalRequest.apiToken,
      },
    ]);
  });

  it("re-reads the managed list, the member list and this server's agent status afterwards", async () => {
    // The managed list is actively mounted here, so invalidating it triggers an immediate refetch
    // (its `isInvalidated` flag would already be back to false by the time we could check it) -
    // a call count is what actually shows the invalidation happened. `servers()` isn't mounted by
    // this view (only by ServerGate elsewhere), so its `isInvalidated` flag does stay observable.
    let managedGets = 0;
    server.use(
      http.get(endpoints.serverManagement.list.route, () => {
        managedGets += 1;
        return HttpResponse.json(managedServersWithAgent);
      }),
    );
    capture("post", endpoints.serverManagement.switchToLocal.route, () =>
      HttpResponse.json({ server: { ...serverConnectionOk.server, id: agentServer.id, displayName: agentServer.displayName } }),
    );
    const view = renderWithClient(<ServerManagementView />);
    fireEvent.click(await screen.findByRole("button", { name: `Switch back to local for ${agentServer.displayName}` }));
    await waitFor(() => expect(managedGets).toBe(1));
    const { client } = view;
    const agentKey = queries.agentStatus(agentServer.id).queryKey;
    client.setQueryData(agentKey, { enrolled: true, online: true, lastSeenAt: null, agentVersion: "0.1.0", connectionKind: "agent" });
    client.setQueryData(queries.servers().queryKey, { servers: [], canManageServers: true });
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Test and switch back" }));
    await screen.findByText(/is read directly again/);
    expect(client.getQueryState(agentKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(queries.servers().queryKey)?.isInvalidated).toBe(true);
    await waitFor(() => expect(managedGets).toBe(2));
  });

  it("sends only one switch request for two submits that land before React re-renders", async () => {
    // Mirrors the same guard's create-mode test (ServerManagementView.test.tsx): the pendingSave
    // ref must also drop a duplicate submit for the newer switchToLocal branch.
    const bodies = capture("post", endpoints.serverManagement.switchToLocal.route, () =>
      HttpResponse.json({ server: { ...serverConnectionOk.server, id: agentServer.id, displayName: agentServer.displayName } }),
    );
    await openSwitch();
    fillConnection();
    const form = screen.getByRole("button", { name: "Test and switch back" }).closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await screen.findByText(/is read directly again/);
    expect(bodies.length).toBe(1);
  });

  it("shows the backend's reason when the connection test fails, and stays on the form", async () => {
    capture("post", endpoints.serverManagement.switchToLocal.route, () =>
      HttpResponse.json(errorConnectionTestFailed, { status: 422 }),
    );
    await openSwitch();
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Test and switch back" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test and switch back" })).toBeInTheDocument();
  });

  it("shows server_not_agent (409) as an error", async () => {
    capture("post", endpoints.serverManagement.switchToLocal.route, () =>
      HttpResponse.json(errorServerNotAgent, { status: 409 }),
    );
    await openSwitch();
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Test and switch back" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("keeps the token out of TanStack's caches", async () => {
    capture("post", endpoints.serverManagement.switchToLocal.route, () =>
      HttpResponse.json({ server: { ...serverConnectionOk.server, id: agentServer.id, displayName: agentServer.displayName } }),
    );
    const { client } = await openSwitch();
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Test and switch back" }));
    await screen.findByText(/is read directly again/);
    const mutations = JSON.stringify(client.getMutationCache().getAll().map((m) => m.state));
    const queryData = JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data));
    expect(mutations).not.toContain(switchToLocalRequest.apiToken);
    expect(queryData).not.toContain(switchToLocalRequest.apiToken);
  });
});
