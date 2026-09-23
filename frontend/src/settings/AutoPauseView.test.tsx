import { fireEvent, screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type SettingsResponse } from "@satisfactory-dash/shared";
import {
  errorNotEditable,
  errorUpstreamUnreachable,
  serversSingle,
  setAutoPauseRequestOff,
  setAutoPauseRequestOn,
  settingsEditable,
  settingsPending,
  settingsReadOnly,
} from "@satisfactory-dash/shared/fixtures";
import { POLL_MS, queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AutoPauseView } from "./AutoPauseView";

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <AutoPauseView />
    </ServerContext>,
  );
}

function settingsReturn(snapshot: SettingsResponse) {
  server.use(http.get(endpoints.settings.get.route, () => HttpResponse.json(snapshot)));
}

const checkbox = () => screen.getByRole("checkbox", { name: /Auto-pause when no players are connected/ });

describe("AutoPauseView", () => {
  it("shows a status while settings load", async () => {
    server.use(
      http.get(endpoints.settings.get.route, async () => {
        await delay(50);
        return HttpResponse.json(settingsEditable);
      }),
    );
    renderView();
    expect(screen.getByRole("status")).toHaveTextContent("Loading settings");
    expect(await screen.findByRole("checkbox")).toBeInTheDocument();
  });

  it("shows the current setting with the ADR-0012 help text", async () => {
    renderView();
    await screen.findByRole("checkbox");
    expect(checkbox()).not.toBeChecked();
    expect(checkbox()).toBeEnabled();
    expect(checkbox()).toHaveAccessibleDescription(
      "Pausing doesn't lower hosting cost and freezes live values, alerts and history.",
    );
  });

  it("turns auto-pause on only when clicked, and shows what the backend returns", async () => {
    let body: unknown;
    server.use(
      http.put(endpoints.settings.setAutoPause.route, async ({ request }) => {
        body = await request.json();
        await delay(30);
        return HttpResponse.json({ ...settingsEditable, data: { ...settingsEditable.data, autoPause: true } });
      }),
    );
    renderView();
    await screen.findByRole("checkbox");
    expect(body).toBeUndefined();

    fireEvent.click(checkbox());
    // No optimistic update: disabled and unchanged until the backend answers.
    await waitFor(() => expect(checkbox()).toBeDisabled());
    expect(checkbox()).not.toBeChecked();
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    await waitFor(() => expect(checkbox()).toBeChecked());
    expect(checkbox()).toBeEnabled();
    expect(body).toEqual(setAutoPauseRequestOn);
  });

  it("turns auto-pause off", async () => {
    let body: unknown;
    settingsReturn({ ...settingsEditable, data: { ...settingsEditable.data, autoPause: true } });
    server.use(
      http.put(endpoints.settings.setAutoPause.route, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settingsEditable);
      }),
    );
    renderView();
    await waitFor(() => expect(checkbox()).toBeChecked());
    fireEvent.click(checkbox());
    await waitFor(() => expect(checkbox()).not.toBeChecked());
    expect(body).toEqual(setAutoPauseRequestOff);
  });

  it("is read-only when the backend can't change the setting", async () => {
    settingsReturn(settingsReadOnly);
    renderView();
    await screen.findByRole("checkbox");
    expect(checkbox()).toBeDisabled();
    expect(checkbox()).toBeChecked();
    expect(screen.getByText("Read-only: the backend has no verified admin token for this server.")).toBeInTheDocument();
  });

  it("notes a pending change and re-reads settings only while one is pending", async () => {
    settingsReturn(settingsPending);
    const { client } = renderView();
    expect(await screen.findByText("Change pending: the server will apply it.")).toBeInTheDocument();

    const options = queries.settings("default");
    const interval = options.refetchInterval;
    if (typeof interval !== "function") throw new Error("settings refetchInterval should depend on pending");
    const query = client.getQueryCache().find({ queryKey: options.queryKey }) as unknown as Parameters<
      typeof interval
    >[0];
    expect(interval(query)).toBe(POLL_MS.settingsPending);
    client.setQueryData(options.queryKey, settingsEditable);
    expect(interval(query)).toBe(false);
  });

  it("shows the backend's message on not_editable and re-reads the settings", async () => {
    let reads = 0;
    server.use(
      http.get(endpoints.settings.get.route, () => {
        reads++;
        return HttpResponse.json(reads === 1 ? settingsEditable : settingsReadOnly);
      }),
      http.put(endpoints.settings.setAutoPause.route, () => HttpResponse.json(errorNotEditable, { status: 409 })),
    );
    renderView();
    await screen.findByRole("checkbox");
    fireEvent.click(checkbox());
    expect(await screen.findByRole("alert")).toHaveTextContent(errorNotEditable.error.message);
    await waitFor(() => expect(checkbox()).toBeDisabled());
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
  });

  it("shows other save errors with their request ID", async () => {
    server.use(
      http.put(endpoints.settings.setAutoPause.route, () =>
        HttpResponse.json(errorUpstreamUnreachable, { status: 502 }),
      ),
    );
    renderView();
    await screen.findByRole("checkbox");
    fireEvent.click(checkbox());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Game server unreachable.");
    expect(alert).toHaveTextContent(errorUpstreamUnreachable.error.requestId);
    expect(checkbox()).not.toBeChecked();
  });

  it("shows an error when settings can't be read", async () => {
    server.use(
      http.get(endpoints.settings.get.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
    );
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Game server unreachable.");
  });
});
