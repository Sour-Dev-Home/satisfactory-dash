import { screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, factoryMixed, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { FactoryView } from "./FactoryView";

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <FactoryView />
    </ServerContext>,
  );
}

describe("FactoryView", () => {
  it("polls factory every 30 s (ADR-0005)", () => {
    expect(queries.factory("default").refetchInterval).toBe(30_000);
  });

  it("shows a status while the factory loads, then the panel", async () => {
    server.use(
      http.get(endpoints.factory.route, async () => {
        await delay(50);
        return HttpResponse.json(factoryMixed);
      }),
    );
    renderView();
    expect(screen.getByRole("status")).toHaveTextContent("Loading factory");
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
  });

  it("shows the error with its request ID when the factory can't be read", async () => {
    server.use(
      http.get(endpoints.factory.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
    );
    renderView();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Game server unreachable.");
    expect(alert).toHaveTextContent(errorUpstreamUnreachable.error.requestId);
  });
});
