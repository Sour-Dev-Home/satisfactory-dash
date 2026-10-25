import { describe, expect, it } from "vitest";
import { StatusResponseSchema } from "../src/index";
import { statusRunning, statusUnreachable } from "../fixtures/index";

// ADR-0052: the envelope's one additive field, unreachableSince.
describe("snapshot envelope unreachableSince (ADR-0052)", () => {
  it("is optional: a reachable snapshot parses without it and stays without it", () => {
    const parsed = StatusResponseSchema.parse(statusRunning);
    expect("unreachableSince" in parsed).toBe(false);
  });

  it("carries the time the outage began", () => {
    expect(StatusResponseSchema.parse(statusUnreachable).unreachableSince).toBe(statusUnreachable.unreachableSince);
  });

  it("rejects a value that is not an ISO time", () => {
    expect(StatusResponseSchema.safeParse({ ...statusUnreachable, unreachableSince: "yesterday" }).success).toBe(false);
  });
});
