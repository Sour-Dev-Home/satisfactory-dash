// Fresh-eyes edge cases for the small-followups PR: display rounding at ties, aborted
// queries, the lost-server guard after an explicit pick, and stale settings.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { endpoints, type PowerResponse, type SettingsResponse } from "@satisfactory-dash/shared";
import {
  errorServerNotFound,
  powerCharging,
  serversSingle,
  settingsEditable,
  settingsPending,
  settingsReadOnly,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { apiGetAbortable } from "./api/client";
import { BackendUnreachableError } from "./api/errors";
import { createQueryClient, POLL_MS, queries, SESSION_KEY } from "./api/queries";
import { formatMW, roundForDisplay } from "./format";
import { PowerPanel } from "./power/PowerPanel";
import { ServerContext } from "./servers/ServerContext";
import { ServerGate } from "./servers/ServerGate";
import { AutoPausePanel } from "./settings/AutoPausePanel";
import { AutoPauseView } from "./settings/AutoPauseView";
import { StatusView } from "./status/StatusView";
import { renderWithClient } from "./test/render";
import { server } from "./test/server";

function batteryFlow(differentialMW: number) {
  const base = powerCharging.data.circuits[0];
  const snapshot = {
    ...powerCharging,
    data: { ...powerCharging.data, circuits: [{ ...base, batteryDifferentialMW: differentialMW }] },
  } satisfies PowerResponse;
  const { unmount } = render(<PowerPanel snapshot={snapshot} />);
  const card = screen.getByRole("article", { name: `Circuit ${base.circuitGroupId}` });
  const text = within(card).getByText("Battery flow", { selector: "dt" }).nextElementSibling?.textContent;
  unmount();
  return text;
}

describe("roundForDisplay matches what the formatters print", () => {
  // The formatter rounds half away from zero; Math.round(x * 10) rounds -0.5 up to -0.
  it.each([-0.05, -0.15, -0.25, -1.45, -2.35, 0.05, 0.15, 1.45, -0.04, 0.04, 1234567.85, -1234567.85])(
    "%d",
    (value) => {
      expect(formatMW(roundForDisplay(value))).toBe(formatMW(value));
    },
  );

  it("labels charging and discharging of the same size symmetrically", () => {
    expect(batteryFlow(0.05)).toBe("Charging 0.1 MW");
    expect(batteryFlow(-0.05)).toBe("Discharging 0.1 MW");
    expect(batteryFlow(0.15)).toBe("Charging 0.2 MW");
    expect(batteryFlow(-0.15)).toBe("Discharging 0.2 MW");
    expect(batteryFlow(-0.049)).toBe("Idle");
  });
});

describe("aborted queries", () => {
  function wrapperFor(client: ReturnType<typeof createQueryClient>) {
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("an unmount abort never becomes a query error, a retry or a sign-out", async () => {
    let reads = 0;
    server.use(
      http.get(endpoints.status.route, async () => {
        reads++;
        await delay(100);
        return HttpResponse.json(statusRunning);
      }),
    );
    const client = createQueryClient();
    const errors: unknown[] = [];
    client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") errors.push(event.action.error);
    });
    const { unmount } = renderHook(() => useQuery(queries.status("default")), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(reads).toBe(1));
    unmount();
    await act(() => delay(200));
    expect(errors).toEqual([]);
    expect(reads).toBe(1);
    expect(client.getQueryData(SESSION_KEY)).toBeUndefined();
    const state = client.getQueryState(queries.status("default").queryKey);
    expect(state?.status).not.toBe("error");
    expect(state?.fetchStatus).toBe("idle");
  });

  it("refetches cleanly when the query mounts again after an abort", async () => {
    server.use(
      http.get(endpoints.status.route, async () => {
        await delay(50);
        return HttpResponse.json(statusRunning);
      }),
    );
    const client = createQueryClient();
    const first = renderHook(() => useQuery(queries.status("default")), { wrapper: wrapperFor(client) });
    await act(() => delay(10));
    first.unmount();
    const second = renderHook(() => useQuery(queries.status("default")), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(second.result.current.data).toEqual(statusRunning));
    expect(second.result.current.isError).toBe(false);
  });

  it("an abort while the body is still arriving rejects with the AbortError", async () => {
    // MSW's mocked bodies don't observe the request signal, so stand in for a browser whose
    // res.text() rejects with the AbortError when the request is aborted mid-body.
    const controller = new AbortController();
    vi.stubGlobal("fetch", (_input: unknown, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            const abort = () => reject(new DOMException("aborted", "AbortError"));
            if (init.signal?.aborted) abort();
            else init.signal?.addEventListener("abort", abort);
          }),
      }),
    );
    try {
      const pending = apiGetAbortable(controller.signal, endpoints.status, "default").catch((e: unknown) => e);
      controller.abort();
      const error = await pending;
      expect(error).not.toBeInstanceOf(BackendUnreachableError);
      expect((error as Error).name).toBe("AbortError");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("lost-server guard after an explicit pick", () => {
  it("shows the picker again (no loop) when the picked server is still gone", async () => {
    let statusReads = 0;
    server.use(
      http.get(endpoints.servers.route, () => HttpResponse.json(serversSingle)),
      http.get(endpoints.status.route, () => {
        statusReads++;
        return HttpResponse.json(errorServerNotFound, { status: 404 });
      }),
    );
    renderWithClient(
      <ServerGate>
        <StatusView />
      </ServerGate>,
    );
    const name = serversSingle.servers[0].displayName;
    expect(await screen.findByText("The selected server is no longer available.")).toBeInTheDocument();
    const afterAuto = statusReads;

    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(statusReads).toBeGreaterThan(afterAuto));
    expect(await screen.findByText("The selected server is no longer available.")).toBeInTheDocument();
    const afterPick = statusReads;
    await act(() => delay(300));
    // Single server, still lost: it isn't auto-selected again, so no further reads.
    expect(statusReads).toBe(afterPick);
    expect(screen.getByRole("heading", { name: "Choose a game server" })).toBeInTheDocument();
  });
});

describe("stale settings", () => {
  const stale = { ...settingsEditable, stale: true } satisfies SettingsResponse;

  it("keeps re-reading, so the toggle comes back once the server is reachable", async () => {
    server.use(http.get(endpoints.settings.get.route, () => HttpResponse.json(stale)));
    const { client } = renderWithClient(
      <ServerContext value={serversSingle.servers[0]}>
        <AutoPauseView />
      </ServerContext>,
    );
    await screen.findByText(/Showing last known settings/);
    const options = queries.settings("default");
    const interval = options.refetchInterval;
    if (typeof interval !== "function") throw new Error("settings refetchInterval should be a function");
    const query = client.getQueryCache().find({ queryKey: options.queryKey }) as unknown as Parameters<
      typeof interval
    >[0];
    // Without a re-read the disabled toggle only recovers on a window focus or remount.
    expect(interval(query)).toBe(POLL_MS.settingsPending);
    client.setQueryData(options.queryKey, settingsEditable);
    expect(interval(query)).toBe(false);
  });

  it("combines with read-only and pending: every reason is described, the toggle stays disabled", () => {
    const snapshot = {
      ...settingsReadOnly,
      stale: true,
      data: { ...settingsReadOnly.data, pending: settingsPending.data.pending },
    } satisfies SettingsResponse;
    render(<AutoPausePanel snapshot={snapshot} onChange={() => {}} saving={true} />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box.getAttribute("aria-describedby")).toBe("auto-pause-help auto-pause-read-only auto-pause-stale");
    expect(screen.getByText("Change pending: the server will apply it.")).toBeInTheDocument();
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("re-enables the toggle once a fresh snapshot replaces the stale one", () => {
    const { rerender } = render(<AutoPausePanel snapshot={stale} onChange={() => {}} saving={false} />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
    rerender(<AutoPausePanel snapshot={settingsEditable} onChange={() => {}} saving={false} />);
    expect(screen.getByRole("checkbox")).toBeEnabled();
    expect(screen.queryByText(/last known settings/)).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(
      "Pausing doesn't lower hosting cost and freezes live values, alerts and history.",
    );
  });
});
