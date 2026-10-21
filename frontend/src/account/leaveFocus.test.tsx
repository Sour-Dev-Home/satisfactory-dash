import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerListResponse, type ServerSummary } from "@satisfactory-dash/shared";
import { sessionAuthenticatedWithAccount } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";

// ADR-0047: after leaving a server, "You left {name}." where the gate lands, with focus on it (or on the picker's
// heading), through the whole app: the shell, ServerGate and Settings.

const viewer = (id: string, displayName: string): ServerSummary => ({ id, displayName, role: "viewer" });
const A = viewer("alpha", "Alpha world");
const B = viewer("bravo", "Bravo world");
const C = viewer("charlie", "Charlie world");

/** The app on Settings, signed in with a stored account; leaving takes the server out of the list the backend answers. */
function renderApp(initial: ServerSummary[]) {
  const state: { list: ServerListResponse } = { list: { servers: initial } };
  server.use(
    http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAuthenticatedWithAccount)),
    http.get(endpoints.servers.route, () => HttpResponse.json(state.list)),
    http.post(endpoints.members.leave.route, ({ params }) => {
      state.list = { servers: state.list.servers.filter((s) => s.id !== params.serverId) };
      return HttpResponse.json({ left: true });
    }),
  );
  window.history.pushState(null, "", "/app/settings");
  return renderWithClient(<App />);
}

async function leave() {
  fireEvent.click(await screen.findByRole("button", { name: "Leave this server…" }));
  fireEvent.click(screen.getByRole("button", { name: "Leave server" }));
}

describe("after leaving a server", () => {
  it("confirms it on the server selected next, with focus there, until the person moves to another page", async () => {
    renderApp([A, B]);
    fireEvent.click(await screen.findByRole("button", { name: "Alpha world" }));
    expect(await screen.findByText("Your role on Alpha world: viewer.")).toBeInTheDocument();
    await leave();
    // One server is left, so the gate selects it at once: the page is now Bravo's, and it says what happened.
    const status = await screen.findByText("You left Alpha world.");
    await waitFor(() => expect(status).toHaveFocus());
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(await screen.findByText("Your role on Bravo world: viewer.")).toBeInTheDocument();
    expect(screen.queryByText("Choose a game server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Power" }));
    await waitFor(() => expect(screen.queryByText("You left Alpha world.")).not.toBeInTheDocument());
  });

  it("says it on the picker when several servers are left, with focus on the picker's heading", async () => {
    renderApp([A, B, C]);
    fireEvent.click(await screen.findByRole("button", { name: "Alpha world" }));
    await leave();
    const heading = await screen.findByRole("heading", { name: "Choose a game server" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("You left Alpha world.")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("button", { name: "Alpha world" })).not.toBeInTheDocument();
    // Picking a server ends the confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Bravo world" }));
    await waitFor(() => expect(screen.queryByText("You left Alpha world.")).not.toBeInTheDocument());
  });

  it("says it on the no-server screen after leaving the last one, with focus on it", async () => {
    renderApp([A]);
    await leave();
    expect(await screen.findByText("No game servers are configured.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("You left Alpha world.")).toHaveFocus());
  });
});
