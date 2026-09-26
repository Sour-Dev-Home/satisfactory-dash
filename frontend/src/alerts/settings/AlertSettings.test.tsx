import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { endpoints, type ServerSummary } from "@satisfactory-dash/shared";
import {
  alertDestinationsConfigured,
  alertDestinationsNone,
  alertMuteClearedResponse,
  alertMuteSetResponse,
  alertRuleUpdatedPresetDisabled,
  alertSendTestOk,
  alertSendTestRateLimited,
  alertStatusShadowMutedFiring,
  serversRoleAdmin,
  serversRoleOwner,
  serversRoleViewer,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { AlertSettings } from "./AlertSettings";

// Settings → Alerts (ADR-0027 PR 9c): the owner/admin controls: who sees them, and that each one
// sends its write and shows the answer. The backend is the real control (a viewer's write is 403).

function renderAs(summary: ServerSummary) {
  return renderWithClient(
    <ServerContext value={summary}>
      <AlertSettings />
    </ServerContext>,
  );
}
const owner = serversRoleOwner.servers[0];
const forbidden = () =>
  HttpResponse.json({ error: { code: "forbidden", message: "Only an owner or admin can change this.", requestId: "req-403" } }, { status: 403 });

describe("the section", () => {
  it("is the #alerts target the header's alert dropdown links to, named Alerts", async () => {
    const { container } = renderAs(owner);
    const section = await screen.findByRole("region", { name: "Alerts" });
    expect(section).toHaveAttribute("id", "alerts");
    expect(container.querySelectorAll("#alerts")).toHaveLength(1);
    for (const part of ["Status", "Discord", "Rules"]) expect(within(section).getByRole("heading", { name: part })).toBeInTheDocument();
  });

  it("loads each part on its own: a failing Discord read leaves the rules", async () => {
    server.use(
      http.get(endpoints.alerts.destinations.get.route, () =>
        HttpResponse.json({ error: { code: "internal", message: "Something went wrong", requestId: "r" } }, { status: 500 }),
      ),
    );
    renderAs(owner);
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(await screen.findByRole("form", { name: "New production target" })).toBeInTheDocument();
  });
});

describe("who gets the controls", () => {
  it.each([
    ["an owner", serversRoleOwner.servers[0]],
    ["an admin", serversRoleAdmin.servers[0]],
  ])("shows them to %s", async (_, summary) => {
    renderAs(summary);
    expect(await screen.findByRole("form", { name: "Mute alerts" })).toBeInTheDocument();
    expect(await screen.findByRole("form", { name: "Discord webhook" })).toBeInTheDocument();
    expect(await screen.findByRole("form", { name: "New production target" })).toBeInTheDocument();
  });

  it.each([
    ["a viewer", serversRoleViewer.servers[0]],
    ["an older backend (no role)", serversSingle.servers[0]],
    ["an unknown role", { ...owner, role: "moderator" }],
  ])("hides them from %s, who still reads everything", async (_, summary) => {
    renderAs(summary);
    expect(await screen.findByText("Only a server owner or admin can change alert rules.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Discord" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Mute alerts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Discord webhook" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send test" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("the Discord controls", () => {
  it("saves the webhook, sends the URL only in the request body, and clears the field", async () => {
    const put = vi.fn();
    server.use(
      http.get(endpoints.alerts.destinations.get.route, () => HttpResponse.json(alertDestinationsNone)),
      http.put(endpoints.alerts.destinations.putDiscord.route, async ({ request }) => {
        put(await request.json());
        return HttpResponse.json({ discord: alertDestinationsConfigured.discord });
      }),
    );
    renderAs(owner);
    const form = await screen.findByRole("form", { name: "Discord webhook" });
    const field = within(form).getByLabelText("Webhook URL");
    expect(field).toHaveAttribute("type", "password");
    fireEvent.change(field, { target: { value: "https://discord.com/api/webhooks/1/secret-token" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save webhook" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ webhookUrl: "https://discord.com/api/webhooks/1/secret-token" }));
    // Saved: the panel shows only the last 4, and the secret is gone from the page.
    expect(await screen.findByText(`…${alertDestinationsConfigured.discord!.last4}`)).toBeInTheDocument();
    expect(within(await screen.findByRole("form", { name: "Discord webhook" })).getByLabelText("New webhook URL")).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("secret-token");
  });

  it("keeps the typed URL and shows the refusal in words when the backend says no", async () => {
    server.use(
      http.put(endpoints.alerts.destinations.putDiscord.route, () =>
        HttpResponse.json(
          { error: { code: "webhook_invalid", message: "Use a Discord webhook URL (https://discord.com/...).", requestId: "r", reason: "host_not_allowed" } },
          { status: 422 },
        ),
      ),
    );
    renderAs(owner);
    const form = await screen.findByRole("form", { name: "Discord webhook" });
    const field = within(form).getByLabelText("New webhook URL");
    fireEvent.change(field, { target: { value: "https://example.com/hook" } });
    fireEvent.click(within(form).getByRole("button", { name: "Replace webhook" }));
    expect(await within(form).findByText(/Use a Discord webhook URL/)).toBeInTheDocument();
    expect(field).toHaveValue("https://example.com/hook");
  });

  it("asks for a URL before sending anything", async () => {
    renderAs(owner);
    const form = await screen.findByRole("form", { name: "Discord webhook" });
    fireEvent.click(within(form).getByRole("button", { name: "Replace webhook" }));
    expect(within(form).getByText("Paste the webhook URL from Discord.")).toBeInTheDocument();
  });

  it.each([
    [alertSendTestOk, "Sent. Check your Discord channel."],
    [alertSendTestRateLimited, "Discord is limiting messages to this webhook right now. Try again in a minute."],
  ])("says what a test found", async (answer, words) => {
    server.use(http.post(endpoints.alerts.destinations.testDiscord.route, () => HttpResponse.json(answer)));
    renderAs(owner);
    fireEvent.click(await screen.findByRole("button", { name: "Send test" }));
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent(words);
  });

  it("turns the webhook off, and removes it behind a confirm", async () => {
    const patched = vi.fn();
    const removed = vi.fn();
    server.use(
      http.patch(endpoints.alerts.destinations.patchDiscord.route, async ({ request }) => {
        patched(await request.json());
        return HttpResponse.json({ discord: { ...alertDestinationsConfigured.discord!, enabled: false, disabledReason: "manual" } });
      }),
      http.delete(endpoints.alerts.destinations.removeDiscord.route, () => {
        removed();
        return HttpResponse.json({ deleted: true });
      }),
    );
    renderAs(owner);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(patched).toHaveBeenCalledWith({ enabled: false }));
    expect(await screen.findByRole("button", { name: "Turn on" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove webhook" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm remove" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removed).toHaveBeenCalled());
    expect(await screen.findByText("No Discord webhook is set, so alerts are only logged.")).toBeInTheDocument();
  });

  it("shows a 403 like any other error: the backend is the real control", async () => {
    server.use(http.post(endpoints.alerts.destinations.testDiscord.route, forbidden));
    renderAs(owner);
    fireEvent.click(await screen.findByRole("button", { name: "Send test" }));
    expect(await screen.findByText(/Only an owner or admin can change this\./)).toBeInTheDocument();
  });
});

describe("the mute", () => {
  it("mutes until the chosen time, sent as UTC", async () => {
    const set = vi.fn();
    server.use(
      http.put(endpoints.alerts.mute.set.route, async ({ request }) => {
        set(await request.json());
        return HttpResponse.json(alertMuteSetResponse);
      }),
    );
    renderAs(owner);
    const form = await screen.findByRole("form", { name: "Mute alerts" });
    const until = new Date(Date.now() + 2 * 3_600_000);
    const local = new Date(until.getTime() - until.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    fireEvent.change(within(form).getByLabelText("Mute until"), { target: { value: local } });
    fireEvent.click(within(form).getByRole("button", { name: "Mute" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith({ until: new Date(local).toISOString() }));
  });

  it("refuses a time more than 7 days ahead, or in the past, before sending", async () => {
    const set = vi.fn();
    server.use(http.put(endpoints.alerts.mute.set.route, () => (set(), HttpResponse.json(alertMuteSetResponse))));
    renderAs(owner);
    const form = await screen.findByRole("form", { name: "Mute alerts" });
    for (const value of ["2000-01-01T00:00", "2999-01-01T00:00"]) {
      fireEvent.change(within(form).getByLabelText("Mute until"), { target: { value } });
      fireEvent.click(within(form).getByRole("button", { name: "Mute" }));
      expect(within(form).getByLabelText("Mute until")).toHaveAccessibleDescription("Choose a time in the future, at most 7 days ahead.");
    }
    expect(set).not.toHaveBeenCalled();
  });

  it("shows the backend's mute_invalid message", async () => {
    server.use(
      http.put(endpoints.alerts.mute.set.route, () =>
        HttpResponse.json({ error: { code: "mute_invalid", message: "Choose a time in the future, at most 7 days ahead", requestId: "r" } }, { status: 422 }),
      ),
    );
    renderAs(owner);
    const form = await screen.findByRole("form", { name: "Mute alerts" });
    fireEvent.click(within(form).getByRole("button", { name: "Mute" }));
    expect(await within(form).findByText(/Choose a time in the future, at most 7 days ahead$/)).toBeInTheDocument();
  });

  it("unmutes when muted", async () => {
    const cleared = vi.fn();
    server.use(
      http.get(endpoints.alerts.status.route, () => HttpResponse.json(alertStatusShadowMutedFiring)),
      http.delete(endpoints.alerts.mute.clear.route, () => (cleared(), HttpResponse.json(alertMuteClearedResponse))),
    );
    renderAs(owner);
    fireEvent.click(await screen.findByRole("button", { name: "Unmute now" }));
    await waitFor(() => expect(cleared).toHaveBeenCalled());
  });
});

describe("the rules editor on the page", () => {
  it("sends a rule change and shows the saved rule", async () => {
    const patched = vi.fn();
    server.use(
      http.patch(endpoints.alerts.rules.update.route, async ({ request, params }) => {
        patched(params.ruleId, await request.json());
        return HttpResponse.json(alertRuleUpdatedPresetDisabled);
      }),
    );
    renderAs(owner);
    const outage = await screen.findByRole("article", { name: "Power outage" });
    fireEvent.click(within(outage).getByRole("checkbox", { name: "Enabled" }));
    fireEvent.click(within(outage).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched).toHaveBeenCalledWith(alertRuleUpdatedPresetDisabled.rule.id, { enabled: false }));
    await waitFor(() => expect(within(screen.getByRole("article", { name: "Power outage" })).getByRole("checkbox", { name: "Enabled" })).not.toBeChecked());
  });

  it("offers today's factory items for a production target", async () => {
    renderAs(owner);
    const form = await screen.findByRole("form", { name: "New production target" });
    await waitFor(() => expect(within(within(form).getByRole("combobox", { name: "Item" })).getAllByRole("option").length).toBeGreaterThan(1));
  });
});
