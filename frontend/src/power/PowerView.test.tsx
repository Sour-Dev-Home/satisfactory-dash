import { screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, powerOk, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PowerView } from "./PowerView";

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <PowerView />
    </ServerContext>,
  );
}

describe("PowerView", () => {
  it("shows a status while power loads, then the panel", async () => {
    server.use(
      http.get(endpoints.power.route, async () => {
        await delay(50);
        return HttpResponse.json(powerOk);
      }),
    );
    renderView();
    expect(screen.getByRole("status")).toHaveTextContent("Loading power");
    expect(await screen.findByRole("region", { name: "Power" })).toBeInTheDocument();
  });

  it("shows the error with its request ID when power can't be read", async () => {
    server.use(http.get(endpoints.power.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })));
    renderView();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Game server unreachable.");
    expect(alert).toHaveTextContent(errorUpstreamUnreachable.error.requestId);
  });
});
