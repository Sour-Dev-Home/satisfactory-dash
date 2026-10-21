import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { serversSelfServe } from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { ServerGate } from "../servers/ServerGate";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { YourServersSection } from "./YourServersSection";

const enrolledServer = serversSelfServe.servers[1];

function renderSection() {
  return renderWithClient(
    <MemoryRouter initialEntries={["/app/settings"]}>
      <ServerGate>
        <YourServersSection />
      </ServerGate>
    </MemoryRouter>,
  );
}

describe("delete versus a list refetch already in flight", () => {
  it("does not bring the deleted server back from a stale answer", async () => {
    let listCalls = 0;
    let releaseStale: () => void = () => {};
    const stale = new Promise<void>((resolve) => (releaseStale = resolve));
    let deleted = false;
    server.use(
      http.get(endpoints.servers.route, async () => {
        listCalls += 1;
        // The second read starts before the delete and answers after it, with the list as it was.
        if (listCalls === 2) {
          const before = { servers: [enrolledServer], selfServeEnabled: false };
          await stale;
          return HttpResponse.json(before);
        }
        return HttpResponse.json({ servers: deleted ? [] : [enrolledServer], selfServeEnabled: false });
      }),
      http.delete(endpoints.serverManagement.remove.route, () => {
        deleted = true;
        return HttpResponse.json({ deleted: true });
      }),
    );
    const { client } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Delete My first world" }));
    fireEvent.change(screen.getByLabelText(/Type My first world to confirm/), { target: { value: "My first world" } });
    void client.refetchQueries({ queryKey: queries.servers().queryKey, exact: true });
    await waitFor(() => expect(listCalls).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Delete this server" }));
    await waitFor(() => expect(deleted).toBe(true));
    await screen.findByText("No game servers are configured.");
    releaseStale();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: "Delete My first world" })).not.toBeInTheDocument();
    expect(client.getQueryData<{ servers: unknown[] }>(queries.servers().queryKey)?.servers).toHaveLength(0);
  });
});

describe("rename", () => {
  it("does not show a previous refusal when the form is opened again", async () => {
    server.use(
      http.get(endpoints.servers.route, () => HttpResponse.json({ servers: [enrolledServer], selfServeEnabled: false })),
      http.patch(endpoints.serverManagement.renameAgent.route, () =>
        HttpResponse.json({ error: { code: "forbidden", message: "no", requestId: "r" } }, { status: 403 }),
      ),
    );
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Rename My first world" }));
    fireEvent.change(screen.getByLabelText("New server name"), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await screen.findByText("Only the owner of a server you added can do that.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rename My first world" }));
    expect(screen.queryByText("Only the owner of a server you added can do that.")).not.toBeInTheDocument();
  });
});
