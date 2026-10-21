import { fireEvent, screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerListResponse } from "@satisfactory-dash/shared";
import { agentStatusEnrolled, serversSelfServe } from "@satisfactory-dash/shared/fixtures";
import { AgentSettings } from "../agent/AgentSettings";
import { SignedInUser } from "../auth/SignedInUser";
import { ServerGate } from "../servers/ServerGate";
import { renderWithClient } from "../test/render";
import { errorDailyLimit, errorLimitAccount } from "../test/selfServeMocks";
import { server } from "../test/server";
import { YourServersSection } from "./YourServersSection";

const [operatorServer, enrolledServer, pendingServer] = serversSelfServe.servers;

function serveList(list: ServerListResponse) {
  server.use(http.get(endpoints.servers.route, () => HttpResponse.json(list)));
}
function renderSection(children = <YourServersSection />) {
  return renderWithClient(
    <MemoryRouter initialEntries={["/app/settings"]}>
      <SignedInUser value={{ name: "Player" }}>
        <ServerGate>{children}</ServerGate>
      </SignedInUser>
    </MemoryRouter>,
  );
}

describe("cap C3: a server still waiting for its first connection", () => {
  it("replaces the add form with one line naming it", async () => {
    serveList({ servers: [pendingServer], selfServeEnabled: true });
    renderSection();
    expect(await screen.findByText("Finish connecting My new world to add another.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Server name")).not.toBeInTheDocument();
  });

  it("names a pending server that is not the selected one", async () => {
    serveList({ servers: [enrolledServer, pendingServer], selfServeEnabled: true });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "My first world" }));
    expect(await screen.findByText("Finish connecting My new world to add another.")).toBeInTheDocument();
  });

  it("offers the form again when the agent already says enrolled, though the list is behind", async () => {
    serveList({ servers: [pendingServer], selfServeEnabled: true });
    server.use(http.get(endpoints.agent.status.route, () => HttpResponse.json(agentStatusEnrolled)));
    renderSection();
    expect(await screen.findByLabelText("Server name")).toBeInTheDocument();
    expect(screen.queryByText(/Finish connecting/)).not.toBeInTheDocument();
  });
});

describe("the pending note", () => {
  it("is not shown until the agent's status is known (no pop-in)", async () => {
    serveList({ servers: [pendingServer], selfServeEnabled: false });
    server.use(
      http.get(endpoints.agent.status.route, async () => {
        await delay(60);
        return HttpResponse.json({ enrolled: false, connectionKind: "agent", lastSeenAt: null, agentVersion: null });
      }),
    );
    renderSection();
    await screen.findByRole("button", { name: "Rename My new world" });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(await screen.findByRole("note")).toBeInTheDocument();
  });

  it("shows name and status like the agent panel: Connected once enrolled", async () => {
    serveList({ servers: [enrolledServer], selfServeEnabled: false });
    renderSection();
    expect(await screen.findByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });
});

describe("refusal styles", () => {
  const add = async (response: Response) => {
    serveList({ servers: [operatorServer], selfServeEnabled: true });
    server.use(http.post(endpoints.selfServe.createAgentServer.route, () => response));
    renderSection();
    fireEvent.change(await screen.findByLabelText("Server name"), { target: { value: "Another" } });
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    return screen.findByRole("alert");
  };

  it("shows a cap or a rate limit as a warning note, with an id the field points to", async () => {
    const alert = await add(Response.json(errorLimitAccount, { status: 409 }));
    expect(alert).toHaveClass("border-warn");
    expect(alert).not.toHaveClass("text-bad-on-soft");
    expect(screen.getByLabelText("Server name")).toHaveAccessibleDescription(expect.stringContaining("one account can have at most 2"));
  });

  it("shows the 429 as a warning note too", async () => {
    const alert = await add(Response.json(errorDailyLimit, { status: 429, headers: { "Retry-After": "600" } }));
    expect(alert).toHaveClass("border-warn");
    expect(alert).toHaveTextContent("Try again in about 10 minutes");
  });

  it("keeps red for a real failure", async () => {
    const alert = await add(Response.json({ error: { code: "forbidden", message: "x", requestId: "r" } }, { status: 403 }));
    expect(alert).toHaveClass("text-bad-on-soft");
    expect(alert).not.toHaveClass("border-warn");
  });
});

describe("the delete confirmation as a form", () => {
  async function openConfirm() {
    serveList({ servers: [enrolledServer], selfServeEnabled: false });
    let deletes = 0;
    server.use(
      http.delete(endpoints.serverManagement.remove.route, () => {
        deletes += 1;
        return HttpResponse.json({ deleted: true });
      }),
    );
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Delete My first world" }));
    return { input: screen.getByLabelText(/Type My first world to confirm/), deletes: () => deletes };
  }

  it("submits with Enter only when the name matches exactly", async () => {
    const { input, deletes } = await openConfirm();
    fireEvent.change(input, { target: { value: "my first world" } }); // the case differs
    fireEvent.submit(input.closest("form")!);
    expect(deletes()).toBe(0);
    fireEvent.change(input, { target: { value: "My first world" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(deletes()).toBe(1));
  });

  it("cancels on Escape and puts focus back on Delete", async () => {
    const { input, deletes } = await openConfirm();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete My first world" })).toHaveFocus());
    expect(screen.queryByRole("form", { name: /Confirm deleting/ })).not.toBeInTheDocument();
    expect(deletes()).toBe(0);
  });
});

describe("the enrolment guide", () => {
  const renderGuide = () => renderSection(<AgentSettings />);

  it("is open while pending and collapsed once enrolled", async () => {
    serveList({ servers: [pendingServer], selfServeEnabled: false });
    server.use(
      http.get(endpoints.agent.status.route, () =>
        HttpResponse.json({ enrolled: false, connectionKind: "agent", lastSeenAt: null, agentVersion: null }),
      ),
    );
    const pending = renderGuide();
    expect((await screen.findByText("Connect your game server")).closest("details")).toHaveAttribute("open");
    pending.unmount();

    serveList({ servers: [enrolledServer], selfServeEnabled: false });
    server.use(http.get(endpoints.agent.status.route, () => HttpResponse.json(agentStatusEnrolled)));
    renderGuide();
    expect((await screen.findByText("Connect your game server")).closest("details")).not.toHaveAttribute("open");
  });
});
