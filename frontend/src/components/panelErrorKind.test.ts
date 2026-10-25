import { describe, expect, it } from "vitest";
import { errorUpstreamUnreachable } from "@satisfactory-dash/shared/fixtures";
import { isUpdatingGap } from "../api/deployGap";
import { ApiError, BackendUnreachableError, ContractDriftError } from "../api/errors";
import { panelErrorKind } from "./panelErrorKind";

const gap = new BackendUnreachableError("/api/x", 530);
const noResponse = new BackendUnreachableError("/api/x");
const plain502 = new BackendUnreachableError("/api/x", 500);
const drift = new ContractDriftError("/api/x", 200, []);
const unreachable = new ApiError(502, errorUpstreamUnreachable.error);

describe("panelErrorKind", () => {
  it("is updating for a deploy-gap error with no data while the gap is recent", () => {
    expect(panelErrorKind(gap, undefined, "updating", false)).toBe("updating");
    expect(panelErrorKind(noResponse, gap, "updating", false)).toBe("updating");
  });

  it("is a notice once the gap has given up", () => {
    expect(panelErrorKind(gap, gap, "down", false)).toBe("notice");
  });

  it("is a notice when no gap phase is active (the error alone is not enough)", () => {
    expect(panelErrorKind(gap, undefined, "none", false)).toBe("notice");
  });

  it("keeps non-gap errors as they are", () => {
    expect(panelErrorKind(plain502, undefined, "updating", false)).toBe("notice");
    expect(panelErrorKind(drift, undefined, "updating", false)).toBe("notice");
  });

  it("never shows updating over data a panel still has", () => {
    expect(panelErrorKind(gap, undefined, "updating", true)).toBe("notice");
  });

  it("keeps the quiet unreachable panel when the status read says so too", () => {
    expect(panelErrorKind(unreachable, unreachable, "none", false)).toBe("unreachable");
    expect(panelErrorKind(unreachable, undefined, "none", false)).toBe("notice");
  });
});

describe("isUpdatingGap", () => {
  it("needs both a gap error and the updating phase", () => {
    expect(isUpdatingGap(gap, "updating")).toBe(true);
    expect(isUpdatingGap(gap, "down")).toBe(false);
    expect(isUpdatingGap(drift, "updating")).toBe(false);
    expect(isUpdatingGap(null, "updating")).toBe(false);
  });
});
