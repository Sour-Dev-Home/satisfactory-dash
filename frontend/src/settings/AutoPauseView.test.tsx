import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { endpoints, type Command, type SettingsResponse } from "@satisfactory-dash/shared";
import {
  autoPauseResponseAccepted,
  commandSent,
  commandSucceeded,
  errorNotEditable,
  errorServerNotFound,
  errorSessionRequired,
  errorUpstreamUnreachable,
  serversSingle,
  setAutoPauseRequestOff,
  setAutoPauseRequestOn,
  settingsEditable,
  settingsPending,
  settingsReadOnly,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { POLL_MS, queries, SESSION_KEY } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { ServerGate } from "../servers/ServerGate";
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

/** Stands in for StatusBanners: a mounted status query for the same server. */
function StatusProbe() {
  useQuery(queries.status("default"));
  return null;
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

  it("a 202 with a COMMAND (a server reached through an agent) isn't cached as the new setting: it shows Saving… until the command succeeds, then re-reads", async () => {
    // The fixture's fixed expiry is in the past on the real clock; the page would give up at once.
    const live = (c: { command: Command }) => ({ command: { ...c.command, expiresAt: new Date(Date.now() + 600_000).toISOString() } });
    let reads = 0;
    let polls = 0;
    server.use(
      http.get(endpoints.settings.get.route, () => {
        reads += 1;
        // The setting has not changed until the game PC has done it.
        const on = polls >= 2;
        return HttpResponse.json({ ...settingsEditable, data: { ...settingsEditable.data, autoPause: on } });
      }),
      http.put(endpoints.settings.setAutoPause.route, () => HttpResponse.json(live(autoPauseResponseAccepted), { status: 202 })),
      http.get(endpoints.commands.get.route, () => {
        polls += 1;
        return HttpResponse.json(live(polls >= 2 ? commandSucceeded : commandSent));
      }),
    );
    renderView();
    await screen.findByRole("checkbox");
    expect(reads).toBe(1);
    fireEvent.click(checkbox());
    expect(await screen.findByText("Saving…")).toBeInTheDocument();
    expect(checkbox()).toBeDisabled();
    expect(checkbox()).not.toBeChecked(); // not overwritten with the command
    await waitFor(() => expect(checkbox()).toBeChecked(), { timeout: 4000 });
    expect(reads).toBe(2);
    expect(checkbox()).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refreshes server status right after a successful change", async () => {
    let statusReads = 0;
    server.use(
      http.get(endpoints.status.route, () => {
        statusReads++;
        return HttpResponse.json(statusRunning);
      }),
      http.put(endpoints.settings.setAutoPause.route, () =>
        HttpResponse.json({ ...settingsEditable, data: { ...settingsEditable.data, autoPause: true } }),
      ),
    );
    renderWithClient(
      <ServerContext value={serversSingle.servers[0]}>
        <StatusProbe />
        <AutoPauseView />
      </ServerContext>,
    );
    await screen.findByRole("checkbox");
    await waitFor(() => expect(statusReads).toBe(1));

    fireEvent.click(checkbox());
    await waitFor(() => expect(checkbox()).toBeChecked());
    // Well inside the 10 s poll: only the invalidation can cause this second read.
    await waitFor(() => expect(statusReads).toBe(2));
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

// Independent review probes (fresh-eyes pass): races, auth, and lifecycle of the saving state.
describe("AutoPauseView edge cases", () => {
  const autoPauseOn = { ...settingsEditable, data: { ...settingsEditable.data, autoPause: true } } satisfies SettingsResponse;

  it("sends one PUT for a rapid double click", async () => {
    let puts = 0;
    server.use(
      http.put(endpoints.settings.setAutoPause.route, async () => {
        puts++;
        await delay(30);
        return HttpResponse.json(autoPauseOn);
      }),
    );
    renderView();
    await screen.findByRole("checkbox");
    fireEvent.click(checkbox());
    fireEvent.click(checkbox());
    await waitFor(() => expect(checkbox()).toBeChecked());
    await delay(50);
    expect(puts).toBe(1);
  });

  it("keeps the PUT's value when an older settings read resolves after it", async () => {
    // A GET that started before the change (a pending poll or an invalidation) must not
    // overwrite the value the PUT returned with the pre-change one.
    let reads = 0;
    server.use(
      http.get(endpoints.settings.get.route, async () => {
        reads++;
        if (reads > 1) await delay(80);
        return HttpResponse.json(settingsEditable);
      }),
      http.put(endpoints.settings.setAutoPause.route, () => HttpResponse.json(autoPauseOn)),
    );
    const { client } = renderView();
    await screen.findByRole("checkbox");
    void client.invalidateQueries({ queryKey: queries.settings("default").queryKey });
    await waitFor(() => expect(reads).toBe(2));
    fireEvent.click(checkbox());
    await waitFor(() => expect(checkbox()).toBeChecked());
    await delay(120);
    expect(checkbox()).toBeChecked();
  });

  it("signs out on a 401 from the PUT (handled in createQueryClient, not the view)", async () => {
    server.use(
      http.put(endpoints.settings.setAutoPause.route, () => HttpResponse.json(errorSessionRequired, { status: 401 })),
    );
    const { client } = renderView();
    await screen.findByRole("checkbox");
    fireEvent.click(checkbox());
    await waitFor(() => expect(client.getQueryData(SESSION_KEY)).toEqual({ authenticated: false }));
  });

  it("clears a previous save error once a retry succeeds", async () => {
    let puts = 0;
    server.use(
      http.put(endpoints.settings.setAutoPause.route, () => {
        puts++;
        return puts === 1
          ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 })
          : HttpResponse.json(autoPauseOn);
      }),
    );
    renderView();
    await screen.findByRole("checkbox");
    fireEvent.click(checkbox());
    await screen.findByRole("alert");
    expect(checkbox()).toBeEnabled();
    fireEvent.click(checkbox());
    await waitFor(() => expect(checkbox()).toBeChecked());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("starts re-reading when the PUT itself reports a pending change, and stops once applied", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let reads = 0;
      server.use(
        http.get(endpoints.settings.get.route, () => {
          reads++;
          return HttpResponse.json(reads === 1 ? settingsEditable : autoPauseOn);
        }),
        http.put(endpoints.settings.setAutoPause.route, () => HttpResponse.json(settingsPending)),
      );
      renderView();
      await screen.findByRole("checkbox");
      fireEvent.click(checkbox());
      await screen.findByText("Change pending: the server will apply it.");
      expect(reads).toBe(1);

      vi.advanceTimersByTime(POLL_MS.settingsPending);
      await waitFor(() => expect(reads).toBe(2));
      await waitFor(() => expect(screen.queryByText(/Change pending/)).not.toBeInTheDocument());
      vi.advanceTimersByTime(POLL_MS.settingsPending * 3);
      await delay(30);
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll settings when nothing is pending", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let reads = 0;
      server.use(
        http.get(endpoints.settings.get.route, () => {
          reads++;
          return HttpResponse.json(settingsEditable);
        }),
      );
      renderView();
      await screen.findByRole("checkbox");
      vi.advanceTimersByTime(POLL_MS.settingsPending * 5);
      await delay(30);
      expect(reads).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the server selection when the PUT answers server_not_found", async () => {
    // CLAUDE.md: server_not_found for the selected server is handled in ServerGate. The
    // mutation's error isn't a query error, so the view has to route it back through a query.
    server.use(
      http.get(endpoints.servers.route, () => HttpResponse.json(serversSingle)),
      http.put(endpoints.settings.setAutoPause.route, () => HttpResponse.json(errorServerNotFound, { status: 404 })),
    );
    renderWithClient(
      <ServerGate>
        <AutoPauseView />
      </ServerGate>,
    );
    await screen.findByRole("checkbox");
    server.use(
      http.get(endpoints.settings.get.route, () => HttpResponse.json(errorServerNotFound, { status: 404 })),
    );
    fireEvent.click(checkbox());
    expect(await screen.findByText("The selected server is no longer available.")).toBeInTheDocument();
  });

  it("gives the read-only reason as part of the checkbox's accessible description", async () => {
    settingsReturn(settingsReadOnly);
    renderView();
    await screen.findByRole("checkbox");
    expect(checkbox()).toHaveAccessibleDescription(/Read-only: the backend has no verified admin token/);
  });

  it("rejects a contract-drifted PUT response without changing the checkbox", async () => {
    server.use(
      http.put(endpoints.settings.setAutoPause.route, () =>
        HttpResponse.json({ ...settingsEditable, data: { autoPause: "yes" } }),
      ),
    );
    renderView();
    await screen.findByRole("checkbox");
    fireEvent.click(checkbox());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(checkbox()).not.toBeChecked();
    expect(checkbox()).toBeEnabled();
  });
});
