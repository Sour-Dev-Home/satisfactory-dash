import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorUpstreamUnreachable,
  playersAvailable,
  playersUnavailable,
  serversSingle,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { OverviewView } from "../overview/OverviewView";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { BasicDataGate } from "./BasicData";

// ADR-0057 Decision 2 step 1: a server with only the game's own API data (the test is a fixture with only `status`).
const NOTICE = /reports only the game's own API, so power, factory and map aren't available/;
const down = () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 });

function vanillaOnly(players: object =playersUnavailable) {
  server.use(
    http.get(endpoints.status.route, () => HttpResponse.json(statusRunning)),
    http.get(endpoints.players.route, () => HttpResponse.json(players)),
    http.get(endpoints.power.route, down),
    http.get(endpoints.factory.route, down),
  );
}

function renderGate() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <BasicDataGate>
          <p>the page</p>
        </BasicDataGate>
      </ServerContext>
    </MemoryRouter>,
  );
}

describe("BasicDataGate", () => {
  it("shows the notice in place of the page when only status answers", async () => {
    vanillaOnly();
    renderGate();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByText("the page")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the page while power and factory answer", async () => {
    renderGate();
    expect(await screen.findByText("the page")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("shows the page when the server has a player list (FRM there, only power failing)", async () => {
    vanillaOnly(playersAvailable);
    renderGate();
    expect(await screen.findByText("the page")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("shows the page when the game itself is unreachable", async () => {
    vanillaOnly();
    server.use(http.get(endpoints.status.route, down));
    renderGate();
    expect(await screen.findByText("the page")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});

describe("OverviewView on a vanilla-only server", () => {
  it("shows the game's facts and the notice, with no Power card or rows", async () => {
    vanillaOnly();
    renderWithClient(
      <MemoryRouter>
        <ServerContext value={serversSingle.servers[0]}>
          <OverviewView />
        </ServerContext>
      </MemoryRouter>,
    );
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByText("21.4/s")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Power/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Factory/ })).not.toBeInTheDocument();
  });
});
