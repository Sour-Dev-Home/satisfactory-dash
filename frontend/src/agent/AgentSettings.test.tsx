import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, type AgentStatusResponse, type ServerSummary } from "@satisfactory-dash/shared";
import {
  agentEnrollmentCodeResponse,
  agentStatusEnrolled,
  agentStatusEnrolledSilent,
  errorForbidden,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AgentSettings } from "./AgentSettings";

const base = serversSingle.servers[0];
const owner: ServerSummary = { ...base, role: "owner" };
const viewer: ServerSummary = { ...base, role: "viewer" };

function renderSection(selected: ServerSummary = base) {
  return renderWithClient(
    <ServerContext value={selected}>
      <AgentSettings />
    </ServerContext>,
  );
}

/** The signed-in user is the dashboard's operator (the server list says they can manage servers). */
function asOperator() {
  server.use(http.get(endpoints.servers.route, () => HttpResponse.json({ ...serversSingle, canManageServers: true })));
}

function agentIs(body: AgentStatusResponse) {
  server.use(http.get(endpoints.agent.status.route, () => HttpResponse.json(body)));
}

beforeEach(() => vi.setSystemTime(Date.parse(agentStatusEnrolled.lastSeenAt) + 8_000));
afterEach(() => vi.useRealTimers());

describe("AgentSettings", () => {
  it("lets the operator create a code for a server reached directly, after saying what enrolling changes", async () => {
    asOperator();
    renderSection();
    expect(await screen.findByText("Directly, from the dashboard's backend")).toBeInTheDocument();
    expect(screen.getByText("None enrolled")).toBeInTheDocument();
    expect(screen.getByText(/forgets its stored game-server tokens/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create enrolment code" }));
    const code = await screen.findByRole("group", { name: "Enrolment code" });
    expect(within(code).getByText(agentEnrollmentCodeResponse.code)).toBeInTheDocument();
    expect(within(code).getByText(/10 minutes/)).toBeInTheDocument();
    expect(within(code).getByRole("time")).toHaveAttribute("dateTime", agentEnrollmentCodeResponse.expiresAt);
    // The agent app's own command (runbooks/agent-app.md), with this code filled in.
    expect(
      within(code).getByText(`node agent.cjs enroll ${agentEnrollmentCodeResponse.code} --url https://<your backend>`),
    ).toBeInTheDocument();
    expect(within(code).getByText("--replace")).toBeInTheDocument();
    // Shown once: the create button is gone while the code is on screen.
    expect(screen.queryByRole("button", { name: /Create/ })).not.toBeInTheDocument();
  });

  it("ignores a second click while the first create is still in flight", async () => {
    let hits = 0;
    asOperator();
    server.use(
      http.post(endpoints.agent.enrollmentCode.route, async () => {
        hits += 1;
        await delay(20);
        return HttpResponse.json(agentEnrollmentCodeResponse, { status: 201 });
      }),
    );
    renderSection();
    const button = await screen.findByRole("button", { name: "Create enrolment code" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText(agentEnrollmentCodeResponse.code);
    expect(hits).toBe(1);
  });

  it("keeps the code out of TanStack's caches: the mutation isn't kept, and no query holds it", async () => {
    asOperator();
    const { client } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Create enrolment code" }));
    await screen.findByText(agentEnrollmentCodeResponse.code);
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
    const cached = JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data));
    expect(cached).not.toContain(agentEnrollmentCodeResponse.code);
  });

  it("forgets the code when the section goes away", async () => {
    asOperator();
    const first = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Create enrolment code" }));
    await screen.findByText(agentEnrollmentCodeResponse.code);
    first.unmount();
    renderSection();
    expect(await screen.findByRole("button", { name: "Create enrolment code" })).toBeInTheDocument();
    expect(screen.queryByText(agentEnrollmentCodeResponse.code)).not.toBeInTheDocument();
  });

  it("offers nothing but says who can, for a server reached directly and a user who isn't the operator", async () => {
    renderSection(owner);
    expect(await screen.findByText("Only the dashboard's operator can enrol an agent for this server.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an enrolled agent's last-seen time and version, and lets an owner enrol again or revoke", async () => {
    agentIs(agentStatusEnrolled);
    renderSection(owner);
    const seen = await screen.findByText("Last seen 8 s ago");
    expect(seen).toHaveAttribute("dateTime", agentStatusEnrolled.lastSeenAt);
    expect(screen.getByText("Through the game PC's agent")).toBeInTheDocument();
    expect(screen.getByText(agentStatusEnrolled.agentVersion)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a code to enrol again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke…" })).toBeInTheDocument();
    expect(screen.queryByText(/forgets its stored/)).not.toBeInTheDocument();
  });

  it("says an enrolled agent that never reported hasn't yet", async () => {
    agentIs(agentStatusEnrolledSilent);
    renderSection(owner);
    expect(await screen.findByText(/Hasn't reported yet/)).toBeInTheDocument();
    expect(screen.getByText("Not reported yet")).toBeInTheDocument();
  });

  // #263: `online` is the backend's call (a snapshot within 2 minutes), never this clock's.
  it("shows the backend's online state: Online, Offline, or nothing from an older backend", async () => {
    agentIs(agentStatusEnrolled);
    const first = renderSection(owner);
    expect(await screen.findByText("Online")).toHaveClass("text-ok");
    first.unmount();

    agentIs(agentStatusEnrolledSilent);
    const second = renderSection(owner);
    expect(await screen.findByText("Offline")).toHaveClass("text-warn");
    second.unmount();

    const { online: _online, ...olderBackend } = agentStatusEnrolled;
    agentIs(olderBackend);
    renderSection(owner);
    await screen.findByText("Last seen 8 s ago");
    expect(screen.queryByText(/^(Online|Offline)$/)).not.toBeInTheDocument();
  });

  it("keeps Online even when this PC's clock says the last-seen time is old", async () => {
    vi.setSystemTime(Date.parse(agentStatusEnrolled.lastSeenAt) + 86_400_000);
    agentIs(agentStatusEnrolled);
    renderSection(owner);
    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.getByText(/^Last seen 1 d /)).toBeInTheDocument();
  });

  it("asks before revoking, says what it does, and can be cancelled", async () => {
    let revoked = 0;
    agentIs(agentStatusEnrolled);
    server.use(
      http.delete(endpoints.agent.revoke.route, () => {
        revoked += 1;
        return HttpResponse.json({ revoked: true });
      }),
    );
    renderSection(owner);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke…" }));
    const confirm = screen.getByRole("group", { name: "Confirm revoking the agent" });
    expect(within(confirm).getByText(/shows no data, and can't be changed, until an agent is enrolled again/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Revoke…" })).toBeInTheDocument();
    expect(revoked).toBe(0);
  });

  it("revokes, then reads the status again", async () => {
    let enrolled = true;
    server.use(
      http.get(endpoints.agent.status.route, () =>
        HttpResponse.json(enrolled ? agentStatusEnrolled : { ...agentStatusEnrolled, enrolled: false, lastSeenAt: null }),
      ),
      http.delete(endpoints.agent.revoke.route, () => {
        enrolled = false;
        return HttpResponse.json({ revoked: true });
      }),
    );
    renderSection(owner);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke…" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke the agent" }));
    expect(await screen.findByText("None enrolled")).toBeInTheDocument();
  });

  it("doesn't reopen the revoke confirm when the agent is enrolled again later", async () => {
    let enrolled = true;
    server.use(
      http.get(endpoints.agent.status.route, () =>
        HttpResponse.json(enrolled ? agentStatusEnrolled : { ...agentStatusEnrolled, enrolled: false, lastSeenAt: null }),
      ),
      http.delete(endpoints.agent.revoke.route, () => {
        enrolled = false;
        return HttpResponse.json({ revoked: true });
      }),
    );
    const { client } = renderSection(owner);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke…" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke the agent" }));
    await screen.findByText("None enrolled");

    // The 30 s poll picks up a fresh enrolment; the confirm the user closed out must not resurface.
    enrolled = true;
    await client.refetchQueries({ queryKey: ["servers", owner.id, "agent"] });
    expect(await screen.findByRole("button", { name: "Revoke…" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Confirm revoking the agent" })).not.toBeInTheDocument();
  });

  it("shows a refused write like any error", async () => {
    agentIs(agentStatusEnrolled);
    server.use(http.post(endpoints.agent.enrollmentCode.route, () => HttpResponse.json(errorForbidden, { status: 403 })));
    renderSection(owner);
    fireEvent.click(await screen.findByRole("button", { name: "Create a code to enrol again" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Enrolment code" })).not.toBeInTheDocument();
  });

  it("lets a viewer read the agent, with no controls", async () => {
    agentIs(agentStatusEnrolled);
    renderSection(viewer);
    expect(await screen.findByText("Last seen 8 s ago")).toBeInTheDocument();
    expect(screen.getByText("Only a server owner or admin can enrol or revoke the agent.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a failed read with Retry", async () => {
    server.use(http.get(endpoints.agent.status.route, () => HttpResponse.json(errorForbidden, { status: 403 })));
    renderSection(owner);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
