import { fireEvent, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerListResponse } from "@satisfactory-dash/shared";
import {
  errorServerNotFound,
  errorUpstreamUnreachable,
  serversMultiple,
  serversNone,
  serversSingle,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { useSelectedServer } from "./ServerContext";
import { ServerGate } from "./ServerGate";

/** Stands in for the views: polls status for the selected server. */
function SelectedStatus() {
  const selected = useSelectedServer();
  const status = useQuery(queries.status(selected.id));
  return <p>{status.data ? `status for ${status.data.serverId}` : "loading status"}</p>;
}

function renderGate() {
  return renderWithClient(
    <ServerGate>
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
    expect(await screen.findByRole("heading", { name: "Satisfactory server" })).toBeInTheDocument();
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
  });

  it("shows an error with a retry when discovery fails", async () => {
    let fail = true;
    server.use(
      http.get(endpoints.servers.route, () =>
        fail ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(serversSingle),
      ),
    );
    renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent(errorUpstreamUnreachable.error.requestId);
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
