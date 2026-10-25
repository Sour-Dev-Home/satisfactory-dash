import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, ServiceUnavailableError, UnauthorizedError } from "../../platform/errorResponse.js";
import { assertOperator, requireOperator, signedInUserId } from "./requireOperator.js";

const rule = { isOperator: (id: string) => id === "op", forbiddenMessage: "Only the operator can do this." };
const resFor = (user?: { id?: unknown }) => ({ locals: { user } });
const run = (handler: ReturnType<typeof requireOperator>, user?: { id?: unknown }) => {
  const next = vi.fn();
  const call = () => handler({} as never, resFor(user) as never, next);
  return { next, call };
};

describe("requireOperator", () => {
  it("lets the operator through", () => {
    const { next, call } = run(requireOperator(rule), { id: "op" });
    call();
    expect(next).toHaveBeenCalledOnce();
  });

  it("is 401 when nobody is signed in (no user, or an id that is not a string)", () => {
    for (const user of [undefined, {}, { id: 7 }]) {
      const { next, call } = run(requireOperator(rule), user);
      expect(call).toThrow(UnauthorizedError);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("is 403 with the caller's wording for anyone else", () => {
    const { next, call } = run(requireOperator(rule), { id: "someone" });
    expect(call).toThrow(ForbiddenError);
    expect(call).toThrow("Only the operator can do this.");
    expect(next).not.toHaveBeenCalled();
  });

  it("checks signed in, then ready (503), then operator (403)", () => {
    const gate = requireOperator({ ...rule, isReady: () => false });
    expect(run(gate, undefined).call).toThrow(UnauthorizedError);
    expect(run(gate, { id: "someone" }).call).toThrow(ServiceUnavailableError);
    expect(run(gate, { id: "op" }).call).toThrow(ServiceUnavailableError);
    const ready = run(requireOperator({ ...rule, isReady: () => true }), { id: "op" });
    ready.call();
    expect(ready.next).toHaveBeenCalledOnce();
  });

  it("assertOperator and signedInUserId follow the same rules", () => {
    expect(assertOperator(resFor({ id: "op" }), rule)).toBe("op");
    expect(() => assertOperator(resFor({ id: "x" }), rule)).toThrow(ForbiddenError);
    expect(() => assertOperator(resFor(), rule)).toThrow(UnauthorizedError);
    expect(signedInUserId(resFor({ id: "u1" }))).toBe("u1");
  });
});
