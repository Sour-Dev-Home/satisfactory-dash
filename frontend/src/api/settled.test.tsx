import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "./queries";
import { isFirstLoad, useSettledQuery } from "./settled";

describe("isFirstLoad", () => {
  it("is true only while pending with no error ever recorded", () => {
    expect(isFirstLoad({ isPending: true, errorUpdateCount: 0 })).toBe(true);
    // A failed read polled again: pending, but it has settled before.
    expect(isFirstLoad({ isPending: true, errorUpdateCount: 2 })).toBe(false);
    expect(isFirstLoad({ isPending: false, errorUpdateCount: 0 })).toBe(false);
  });
});

/** A query whose answers the test releases one at a time. */
function controlled() {
  const pending: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];
  const options = queryOptions({
    queryKey: ["settled-test"],
    queryFn: () => new Promise<string>((resolve, reject) => pending.push({ resolve, reject })),
  });
  return { options, next: () => pending.at(-1)!, calls: () => pending.length };
}

function setup() {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const q = controlled();
  const hook = renderHook(() => useSettledQuery(q.options), { wrapper });
  return { client, q, hook };
}

describe("useSettledQuery", () => {
  it("is a first load until the first answer", async () => {
    const { q, hook } = setup();
    await waitFor(() => expect(q.calls()).toBe(1));
    expect(hook.result.current.firstLoad).toBe(true);
    expect(hook.result.current.error).toBeNull();
  });

  it("keeps the last error while a failed query refetches, and drops it once data arrives", async () => {
    const { client, q, hook } = setup();
    await waitFor(() => expect(q.calls()).toBe(1));
    const failure = new Error("down");
    await act(async () => q.next().reject(failure));
    await waitFor(() => expect(hook.result.current.query.isError).toBe(true));
    expect(hook.result.current.error).toBe(failure);

    // The refetch puts the query back to pending with its error cleared (TanStack Query v5)...
    act(() => void client.refetchQueries({ queryKey: q.options.queryKey }));
    await waitFor(() => expect(q.calls()).toBe(2));
    await waitFor(() => expect(hook.result.current.query.isPending).toBe(true));
    expect(hook.result.current.query.error).toBeNull();
    // ...but it isn't a first load, and the last error is still the one to show.
    expect(hook.result.current.firstLoad).toBe(false);
    expect(hook.result.current.error).toBe(failure);

    await act(async () => q.next().resolve("ok"));
    await waitFor(() => expect(hook.result.current.query.data).toBe("ok"));
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.firstLoad).toBe(false);
  });

  it("shows the newer error after a second failure", async () => {
    const { client, q, hook } = setup();
    await waitFor(() => expect(q.calls()).toBe(1));
    await act(async () => q.next().reject(new Error("first")));
    act(() => void client.refetchQueries({ queryKey: q.options.queryKey }));
    await waitFor(() => expect(q.calls()).toBe(2));
    const second = new Error("second");
    await act(async () => q.next().reject(second));
    await waitFor(() => expect(hook.result.current.error).toBe(second));
  });
});
