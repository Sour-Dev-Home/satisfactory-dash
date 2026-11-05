import { render, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { powerOk, serversSingle, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { createQueryClient, queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { server } from "../test/server";
import { PageAge } from "./PageAge";

const SERVER = serversSingle.servers[0];

function renderAt(path: string, fill: (client: ReturnType<typeof createQueryClient>) => void = () => {}) {
  const client = createQueryClient();
  fill(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ServerContext value={SERVER}>
          <PageAge />
        </ServerContext>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return view.container.querySelector("[data-page-age]")!;
}

// ADR-0064 Decision 6: the page's one freshness badge, beside the server picker.
describe("PageAge", () => {
  it("shows the age of the page's primary read from the cache: the status on the Overview", () => {
    const age = renderAt("/app", (c) => c.setQueryData(queries.status(SERVER.id).queryKey, statusRunning));
    expect(age.querySelector("[data-age] time")).toHaveAttribute("dateTime", statusRunning.observedAt);
  });

  it("follows the page: the power read on Power", () => {
    const age = renderAt("/app/power", (c) => c.setQueryData(queries.power(SERVER.id).queryKey, powerOk));
    expect(age.querySelector("[data-age] time")).toHaveAttribute("dateTime", powerOk.observedAt);
  });

  it("is late when the backend says the data is stale", () => {
    const age = renderAt("/app/power", (c) => c.setQueryData(queries.power(SERVER.id).queryKey, { ...powerOk, stale: true }));
    expect(age.querySelector("[data-age]")).toHaveClass("text-warn");
    expect(age).toHaveTextContent("newer data is overdue");
  });

  it("keeps an empty slot of the badge's width before the read lands, and never fetches it itself", async () => {
    let reads = 0;
    server.use(http.get(endpoints.status.route, () => (reads++, HttpResponse.json(statusRunning))));
    const age = renderAt("/app");
    expect(age).toHaveAttribute("aria-hidden", "true");
    expect(age).toHaveClass("min-w-20");
    expect(age.querySelector("[data-age]")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(reads).toBe(0);
  });

  it.each(["/app/", "/nope"])("draws nothing, without crashing, on %s: a page with no primary read", (path) => {
    expect(renderAt(path)).toBeNull();
  });

  it("is not late when the response carries no stale flag", () => {
    const { stale: _stale, ...bare } = powerOk as typeof powerOk & { stale?: boolean };
    // An older backend's envelope without `stale`: not the contract's type, hence the cast.
    const age = renderAt("/app/power", (c) => c.setQueryData(queries.power(SERVER.id).queryKey, bare as never));
    expect(age.querySelector("[data-age]")).not.toHaveClass("text-warn");
  });

  it("shows the age of the selected server, not the previous one", () => {
    const client = createQueryClient();
    const other = { ...SERVER, id: "other" };
    client.setQueryData(queries.power(SERVER.id).queryKey, powerOk);
    client.setQueryData(queries.power(other.id).queryKey, { ...powerOk, observedAt: "2020-01-01T00:00:00.000Z" });
    const ui = (s: typeof SERVER) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/app/power"]}>
          <ServerContext value={s}>
            <PageAge />
          </ServerContext>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(ui(SERVER));
    expect(view.container.querySelector("time")).toHaveAttribute("dateTime", powerOk.observedAt);
    view.rerender(ui(other));
    expect(view.container.querySelector("time")).toHaveAttribute("dateTime", "2020-01-01T00:00:00.000Z");
  });

  it("is late after a failed refresh, and does not stop a sibling observer's polling", async () => {
    let reads = 0;
    server.use(http.get(endpoints.power.route, () => (reads++, HttpResponse.json({ error: "x" }, { status: 500 }))));
    const client = createQueryClient();
    client.setQueryData(queries.power(SERVER.id).queryKey, powerOk);
    function Panel() {
      useQuery({ ...queries.power(SERVER.id), refetchInterval: 20, retry: false, staleTime: 0 });
      return null;
    }
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/app/power"]}>
          <ServerContext value={SERVER}>
            <PageAge />
            <Panel />
          </ServerContext>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(reads).toBeGreaterThan(2));
    expect(view.container.querySelector("[data-age]")).toHaveClass("text-warn");
  });
});
