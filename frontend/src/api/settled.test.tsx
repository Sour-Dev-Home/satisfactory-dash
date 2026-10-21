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

describe("useSettledQuery: cache lifecycle", () => {
  it("does not leak a query's error to another key, or back after the query is reset", async () => {
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const calls: Array<{ key: string; reject: (e: unknown) => void; resolve: (v: string) => void }> = [];
    const opts = (key: string) =>
      queryOptions({
        queryKey: ["lifecycle", key],
        queryFn: () => new Promise<string>((resolve, reject) => calls.push({ key, resolve, reject })),
      });
    const hook = renderHook(({ key }) => useSettledQuery(opts(key)), { wrapper, initialProps: { key: "a" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].reject(new Error("a down")));
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());

    // Another server: its own first load, nothing of a's error.
    hook.rerender({ key: "b" });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(hook.result.current.firstLoad).toBe(true);
    expect(hook.result.current.error).toBeNull();

    // Back to a (cached, errored): the refetch is not a first load and a's error is still its own.
    hook.rerender({ key: "a" });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(hook.result.current.firstLoad).toBe(false);
    expect((hook.result.current.error as Error).message).toBe("a down");

    // A reset query is a first load again, with no stale error.
    await act(async () => void client.resetQueries({ queryKey: ["lifecycle", "a"] }));
    await waitFor(() => expect(hook.result.current.firstLoad).toBe(true));
    expect(hook.result.current.error).toBeNull();
  });
});
