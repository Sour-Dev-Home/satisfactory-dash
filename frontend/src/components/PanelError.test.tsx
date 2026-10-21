import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, serversSingle, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PowerView } from "../power/PowerView";

const srv = serversSingle.servers[0];
const down = (route: string) => http.get(route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 503 }));

function renderPower() {
  return renderWithClient(
    <ServerContext value={srv}>
      <PowerView />
    </ServerContext>,
  );
}

describe("PanelError", () => {
  it("is quiet while status is unreachable too, and speaks up once status answers but the panel stays down", async () => {
    server.use(down(endpoints.status.route), down(endpoints.power.route));
    const { client } = renderPower();
    await waitFor(() => expect(client.getQueryState(queries.status(srv.id).queryKey)?.status).toBe("error"));
    await screen.findByText(/No data while the game server is unreachable/);
    expect(screen.queryByRole("alert")).toBeNull();

    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusRunning)));
    await act(() => client.refetchQueries({ queryKey: queries.status(srv.id).queryKey }));
    await waitFor(() => expect(screen.getByText("Game server unreachable.")).toBeTruthy());
    expect(screen.queryByText(/No data while the game server/)).toBeNull();
  });

  it("drops the error once the panel recovers", async () => {
    server.use(down(endpoints.status.route), down(endpoints.power.route));
    const { client } = renderPower();
    await screen.findByText(/No data while the game server is unreachable/);
    server.resetHandlers();
    await act(() => client.refetchQueries());
    await waitFor(() => expect(screen.queryByText(/No data while the game server/)).toBeNull());
    expect(screen.queryByText("Game server unreachable.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
