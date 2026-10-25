import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorUpstreamUnreachable } from "@satisfactory-dash/shared/fixtures";
import { DEPLOY_GAP_GIVE_UP_MS, DEPLOY_GAP_RETRY_BASE_MS, DEPLOY_GAP_RETRY_CAP_MS, useDeployGapPhase } from "./deployGap";
import { ApiError, BackendUnreachableError } from "./errors";
import { createQueryClient } from "./queries";

// ADR-0054 D4 with a fake clock: what the backend answers is switched by the test, the waits are the module's own.

type Answer = "ok" | "gap-530" | "gap-network" | "html-500" | "envelope-503";

function setup() {
  let answer: Answer = "ok";
  let calls = 0;
  let version = 0;
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(
    () => ({
      phase: useDeployGapPhase(),
      query: useQuery({
        queryKey: ["gap-test"],
        // No built-in retry: the waits under test are the module's, not TanStack's.
        retry: false,
        queryFn: async () => {
          calls += 1;
          switch (answer) {
            case "ok":
              version += 1;
              return `data ${version}`;
            case "gap-530":
              throw new BackendUnreachableError("/api/x", 530);
            case "gap-network":
              throw new BackendUnreachableError("/api/x", undefined, { cause: new TypeError("Failed to fetch") });
            case "html-500":
              throw new BackendUnreachableError("/api/x", 500);
            case "envelope-503":
              throw new ApiError(503, errorUpstreamUnreachable.error);
          }
        },
      }),
    }),
    { wrapper },
  );
  return {
    hook,
    client,
    setAnswer: (next: Answer) => (answer = next),
    calls: () => calls,
    /** Asks for a fresh read, as a poll tick would. */
    poll: () => act(() => client.refetchQueries({ queryKey: ["gap-test"] })),
    advance: (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms)),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("deploy gap", () => {
  it("starts with no notice, and says 'updating' on a 530 while keeping the last data", async () => {
    const t = setup();
    await t.advance(0);
    expect(t.hook.result.current.phase).toBe("none");
    expect(t.hook.result.current.query.data).toBe("data 1");

    t.setAnswer("gap-530");
    await t.poll();
    expect(t.hook.result.current.phase).toBe("updating");
    expect(t.hook.result.current.query.data).toBe("data 1");
    expect(t.hook.result.current.query.isError).toBe(true);
  });

  it("treats a network failure as a gap too", async () => {
    const t = setup();
    await t.advance(0);
    t.setAnswer("gap-network");
    await t.poll();
    expect(t.hook.result.current.phase).toBe("updating");
  });

  it("does not treat a non-gap proxy page (500) or the API's own 503 envelope as a gap", async () => {
    const t = setup();
    await t.advance(0);
    t.setAnswer("html-500");
    await t.poll();
    expect(t.hook.result.current.phase).toBe("none");
    t.setAnswer("envelope-503");
    await t.poll();
    expect(t.hook.result.current.phase).toBe("none");
  });

  it("retries with growing waits, capped at the last one", async () => {
    const t = setup();
    await t.advance(0);
    t.setAnswer("gap-530");
    await t.poll();
    const afterFirstFailure = t.calls();

    // 5, 10, 20, 30, 30 s: each retry happens exactly at its wait, not before.
    let expected = afterFirstFailure;
    for (const wait of [5_000, 10_000, 20_000, 30_000, 30_000]) {
      await t.advance(wait - 1);
      expect(t.calls()).toBe(expected);
      await t.advance(1);
      expected += 1;
      expect(t.calls()).toBe(expected);
    }
    expect([DEPLOY_GAP_RETRY_BASE_MS, DEPLOY_GAP_RETRY_CAP_MS]).toEqual([5_000, 30_000]);
  });

  it("clears the notice and shows fresh data when the backend answers again", async () => {
    const t = setup();
    await t.advance(0);
    t.setAnswer("gap-530");
    await t.poll();
    expect(t.hook.result.current.phase).toBe("updating");

    t.setAnswer("ok");
    await t.advance(DEPLOY_GAP_RETRY_BASE_MS);
    expect(t.hook.result.current.phase).toBe("none");
    expect(t.hook.result.current.query.data).toBe("data 2");
    // No timers left: nothing keeps retrying once it is over.
    const calls = t.calls();
    await t.advance(120_000);
    expect(t.calls()).toBe(calls);
  });

  it("clears when the backend answers with its own error envelope", async () => {
    const t = setup();
    await t.advance(0);
    t.setAnswer("gap-530");
    await t.poll();
    t.setAnswer("envelope-503");
    await t.advance(DEPLOY_GAP_RETRY_BASE_MS);
    expect(t.hook.result.current.phase).toBe("none");
  });

  it("falls back to 'down' after the give-up time and keeps retrying; recovery still clears it", async () => {
    const t = setup();
    await t.advance(0);
    t.setAnswer("gap-530");
    await t.poll();

    await t.advance(DEPLOY_GAP_GIVE_UP_MS - 1);
    expect(t.hook.result.current.phase).toBe("updating");
    await t.advance(1);
    expect(t.hook.result.current.phase).toBe("down");
    expect(DEPLOY_GAP_GIVE_UP_MS).toBe(180_000);

    const calls = t.calls();
    await t.advance(DEPLOY_GAP_RETRY_CAP_MS);
    expect(t.calls()).toBeGreaterThan(calls);
    expect(t.hook.result.current.phase).toBe("down");

    t.setAnswer("ok");
    await t.advance(DEPLOY_GAP_RETRY_CAP_MS);
    expect(t.hook.result.current.phase).toBe("none");
  });

  it("does not restart the give-up clock on each failed retry", async () => {
    const t = setup();
    await t.advance(0);
    t.setAnswer("gap-530");
    await t.poll();
    await t.advance(DEPLOY_GAP_GIVE_UP_MS);
    expect(t.hook.result.current.phase).toBe("down");
  });
});
