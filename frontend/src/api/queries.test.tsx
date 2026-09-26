import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { server } from "../test/server";
import { ApiError, BackendUnreachableError, ContractDriftError } from "./errors";
import { POLL_MS, createQueryClient, queries, shouldRetry } from "./queries";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

describe("query options", () => {
  it("polls status and power every 10 s and factory every 30 s (ADR-0005)", () => {
    expect(queries.status("default").refetchInterval).toBe(10_000);
    expect(queries.power("default").refetchInterval).toBe(10_000);
    expect(queries.factory("default").refetchInterval).toBe(30_000);
    expect(POLL_MS).toEqual({
      status: 10_000,
      power: 10_000,
      factory: 30_000,
      settingsPending: 10_000,
      alerts: 60_000,
      command: 1_000,
    });
  });

  it("reads alerts once a minute, never at the page's rate: the bell polls on every page (ADR-0027 PR 9)", () => {
    expect(queries.alertStatus("default").refetchInterval).toBe(60_000);
    expect(queries.alertStatus("default").staleTime).toBe(60_000);
    expect(queries.alertEvents("default").refetchInterval).toBe(60_000);
    expect(queries.alertStatus("a").queryKey).toEqual(["servers", "a", "alerts", "status"]);
  });

  it("keys server-scoped queries by server id", () => {
    expect(queries.status("a").queryKey).not.toEqual(queries.status("b").queryKey);
  });
});

describe("shouldRetry", () => {
  const apiError = new ApiError(502, errorUpstreamUnreachable.error);

  it("retries once, and only when the backend couldn't be reached", () => {
    expect(shouldRetry(0, new BackendUnreachableError("/api/x"))).toBe(true);
    expect(shouldRetry(1, new BackendUnreachableError("/api/x"))).toBe(false);
  });

  it("never retries an API error or contract drift", () => {
    expect(shouldRetry(0, apiError)).toBe(false);
    expect(shouldRetry(0, new ContractDriftError("/api/x", 200, []))).toBe(false);
  });
});

describe("polling", () => {
  it("never has more than one request in flight when a fetch outlasts the interval", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    server.use(
      http.get(endpoints.status.route, async () => {
        calls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(120);
        inFlight--;
        return HttpResponse.json(statusRunning);
      }),
    );

    // A 20 ms interval against a 120 ms response: several ticks land mid-fetch.
    const { result } = renderHook(() => useQuery({ ...queries.status("default"), refetchInterval: 20 }), {
      wrapper,
    });
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(result.current.data).toEqual(statusRunning);
    expect(maxInFlight).toBe(1);
  });
});
