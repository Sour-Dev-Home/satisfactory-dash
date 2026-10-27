import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  plannerDesignationListRevised,
  plannerDesignationOverlapError,
  plannerDesignationReplaceRequestMerge,
  plannerDesignationReplaceResponse,
  plannerDesignationStaleError,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { server } from "../test/server";
import { isStaleDesignation, usePlannerDesignationWrites } from "./plannerWrites";
import { RequestValidationError } from "./errors";
import { createQueryClient, queries } from "./queries";

const SERVER = serversSingle.servers[0].id;

function setup() {
  const client = createQueryClient();
  client.setQueryData(queries.plannerDesignations(SERVER).queryKey, plannerDesignationListRevised);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => usePlannerDesignationWrites(SERVER), { wrapper });
  const invalid = () => client.getQueryState(queries.plannerDesignations(SERVER).queryKey)?.isInvalidated;
  return { result, invalid };
}

describe("usePlannerDesignationWrites().replace", () => {
  it("posts the replace and marks the designations stale for a re-read", async () => {
    let body: unknown;
    server.use(
      http.post(endpoints.plannerDesignations.replace.route, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(plannerDesignationReplaceResponse);
      }),
    );
    const { result, invalid } = setup();
    const answer = await act(() => result.current.replace.mutateAsync(plannerDesignationReplaceRequestMerge));
    expect(body).toEqual(plannerDesignationReplaceRequestMerge);
    expect(answer.removedIds).toEqual(plannerDesignationReplaceResponse.removedIds);
    expect(invalid()).toBe(true);
  });

  it("re-reads on designation_stale and hands the error on", async () => {
    server.use(http.post(endpoints.plannerDesignations.replace.route, () => HttpResponse.json(plannerDesignationStaleError, { status: 409 })));
    const { result, invalid } = setup();
    let caught: unknown;
    await act(async () => {
      caught = await result.current.replace.mutateAsync(plannerDesignationReplaceRequestMerge).catch((e: unknown) => e);
    });
    expect(isStaleDesignation(caught)).toBe(true);
    expect(invalid()).toBe(true);
  });

  it("leaves the reads alone on an overlap, which is not stale", async () => {
    server.use(http.post(endpoints.plannerDesignations.replace.route, () => HttpResponse.json(plannerDesignationOverlapError, { status: 409 })));
    const { result, invalid } = setup();
    let caught: unknown;
    await act(async () => {
      caught = await result.current.replace.mutateAsync(plannerDesignationReplaceRequestMerge).catch((e: unknown) => e);
    });
    expect(isStaleDesignation(caught)).toBe(false);
    expect(invalid()).toBe(false);
  });

  it("never sends a request the contract refuses (an empty one)", async () => {
    const { result } = setup();
    let caught: unknown;
    await act(async () => {
      caught = await result.current.replace.mutateAsync({ expect: [], put: [] }).catch((e: unknown) => e);
    });
    expect(caught).toBeInstanceOf(RequestValidationError);
  });
});
