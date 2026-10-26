import { describe, expect, it } from "vitest";
import { compatResponse } from "@satisfactory-dash/shared/fixtures";
import { clientOf, severityOf, updateNotices } from "./notices";

// compatResponse: mod current 1.2.0 / supported 1.0.0 / safe 1.1.0 / advisory ">=1.0.0 <1.1.0" fixed 1.1.0;
// agent current 0.4.0 / supported 0.2.0 / safe 0.3.0 / no advisories.

describe("clientOf", () => {
  it("tells the mod (mod/x.y.z) from the agent (a bare version)", () => {
    expect(clientOf("mod/1.2.0")).toEqual({ kind: "mod", version: "1.2.0" });
    expect(clientOf("0.1.0+ec24244.20261025")).toEqual({ kind: "agent", version: "0.1.0+ec24244.20261025" });
  });

  it("is null when nothing was reported", () => {
    expect(clientOf(null)).toBeNull();
    expect(clientOf(undefined)).toBeNull();
    expect(clientOf("")).toBeNull();
  });
});

describe("updateNotices", () => {
  it("is null when up to date, newer than current, unreported or without a policy", () => {
    expect(updateNotices("0.4.0", compatResponse)).toBeNull();
    expect(updateNotices("0.4.0+abc.20261025", compatResponse)).toBeNull();
    expect(updateNotices("9.0.0", compatResponse)).toBeNull();
    expect(updateNotices(null, compatResponse)).toBeNull();
    expect(updateNotices("0.1.0", undefined)).toBeNull();
  });

  it("shows nothing for a malformed version, never a false alarm", () => {
    for (const v of ["junk", "0.1", "mod/", "mod/junk", "0.1.0 beta", "latest"]) expect(updateNotices(v, compatResponse)).toBeNull();
  });

  it("offers an update when only behind current", () => {
    const n = updateNotices("0.3.5", compatResponse);
    expect(n).toMatchObject({ kind: "agent", version: "0.3.5", current: "0.4.0", updateAvailable: true, unsupported: false, security: [] });
    expect(severityOf(n!)).toBe("update");
  });

  it("uses the mod's policy for mod/ versions and ignores the build metadata", () => {
    const n = updateNotices("mod/1.1.5+abc.20261025", compatResponse);
    expect(n).toMatchObject({ kind: "mod", version: "1.1.5+abc.20261025", current: "1.2.0", updateAvailable: true, security: [] });
  });

  it("flags an unsupported version", () => {
    const policy = { ...compatResponse, agent: { ...compatResponse.agent, minSafe: "0.1.0" } };
    const n = updateNotices("0.1.9", policy);
    expect(n).toMatchObject({ unsupported: true, minSupported: "0.2.0", updateAvailable: true, security: [] });
    expect(severityOf(n!)).toBe("unsupported");
  });

  it("flags a version inside an advisory's range, naming the fix", () => {
    const n = updateNotices("mod/1.0.5", compatResponse);
    expect(n?.security).toEqual([{ id: "SD-2026-001", fixed: "1.1.0", summary: "An example advisory for the tests." }]);
    expect(severityOf(n!)).toBe("security");
  });

  it("does not flag the advisory at its fixed version", () => {
    expect(updateNotices("mod/1.1.0", compatResponse)?.security).toEqual([]);
  });

  it("flags a version below minSafe with no advisory, naming minSafe", () => {
    const n = updateNotices("0.2.5", compatResponse);
    expect(n?.security).toEqual([{ id: null, fixed: "0.3.0", summary: null }]);
  });

  it("lists only the advisories in range, and no generic entry beside them", () => {
    const policy = {
      ...compatResponse,
      mod: {
        ...compatResponse.mod,
        advisories: [
          { id: "A", affected: "<1.1.0", fixed: "1.1.0", summary: "a" },
          { id: "B", affected: ">=1.0.0 <1.0.5 || =1.0.7", fixed: "1.0.5", summary: "b" },
          { id: "C", affected: ">=1.5.0", fixed: "1.6.0", summary: "c" },
        ],
      },
    };
    expect(updateNotices("mod/1.0.7", policy)?.security.map((s) => s.id)).toEqual(["A", "B"]);
    expect(updateNotices("mod/1.0.2", policy)?.security.map((s) => s.id)).toEqual(["A", "B"]);
    expect(updateNotices("mod/1.0.6", policy)?.security.map((s) => s.id)).toEqual(["A"]);
  });

  it("skips an advisory whose range cannot be read", () => {
    const policy = { ...compatResponse, mod: { ...compatResponse.mod, minSafe: "1.0.0", advisories: [{ id: "X", affected: "~1.0", fixed: "1.1.0", summary: "x" }] } };
    expect(updateNotices("mod/1.0.5", policy)?.security).toEqual([]);
  });

  it("reads each component against its own policy", () => {
    // 0.9.0 is far above the agent's current but below the mod's; the kind decides.
    expect(updateNotices("0.9.0", compatResponse)).toBeNull();
    expect(updateNotices("mod/0.9.0", compatResponse)?.unsupported).toBe(true);
  });
});
