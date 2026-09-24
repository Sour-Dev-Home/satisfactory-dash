import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { statusRunning } from "@satisfactory-dash/shared/fixtures";
import { server } from "../test/server";
import { apiGetAbortable } from "./client";
import { BackendUnreachableError } from "./errors";
import { createQueryClient, queries } from "./queries";

/** A slow status handler that records whether the browser aborted its request. */
function slowStatus() {
  const seen = { started: false, aborted: false };
  server.use(
    http.get(endpoints.status.route, async ({ request }) => {
      seen.started = true;
      request.signal.addEventListener("abort", () => (seen.aborted = true));
      await delay(200);
      return HttpResponse.json(statusRunning);
    }),
  );
  return seen;
}

describe("request cancellation", () => {
  it("rejects with the AbortError, not BackendUnreachableError, when its own signal aborts", async () => {
    slowStatus();
    const controller = new AbortController();
    const pending = apiGetAbortable(controller.signal, endpoints.status, "default");
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(BackendUnreachableError);
    expect((error as Error).name).toBe("AbortError");
  });

  it("aborts the network request when a query's last observer unmounts", async () => {
    const seen = slowStatus();
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { unmount } = renderHook(() => useQuery(queries.status("default")), { wrapper });
    await waitFor(() => expect(seen.started).toBe(true));
    unmount();
    await waitFor(() => expect(seen.aborted).toBe(true));
  });

  it("aborts the network request when the query is cancelled", async () => {
    const seen = slowStatus();
    const client = createQueryClient();
    void client.fetchQuery(queries.status("default")).catch(() => {});
    await waitFor(() => expect(seen.started).toBe(true));
    await client.cancelQueries({ queryKey: queries.status("default").queryKey });
    await waitFor(() => expect(seen.aborted).toBe(true));
  });
});
