import { describe, expect, it } from "vitest";
import { compareVersions, isOlder, parseVersion, versionInRange } from "./version";

describe("parseVersion", () => {
  it("reads a release, a prerelease and a leading v", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("v1.2.3-rc.1")).toEqual({ major: 1, minor: 2, patch: 3, pre: ["rc", "1"] });
  });

  it("accepts and ignores build metadata", () => {
    expect(parseVersion("0.1.0+ec24244.20261025")).toEqual({ major: 0, minor: 1, patch: 0, pre: [] });
    expect(parseVersion("0.1.0-beta.2+abc")).toEqual({ major: 0, minor: 1, patch: 0, pre: ["beta", "2"] });
  });

  it.each(["", " ", "1", "1.2", "1.2.3.4", "a.b.c", "1.2.x", "1.2.3-", "1.2.3+", "mod/1.2.3", "1.2.3 4", "-1.2.3", "1..3", "9999999.0.0"])(
    "returns null for %j",
    (text) => {
      expect(parseVersion(text)).toBeNull();
    },
  );
});

describe("compareVersions", () => {
  it("orders numerically, not as text", () => {
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("ignores build metadata", () => {
    expect(compareVersions("0.1.0+a.20260101", "0.1.0+b.20270101")).toBe(0);
    expect(compareVersions("0.1.0+ec24244.20261025", "0.2.0")).toBe(-1);
  });

  it("puts a prerelease below its release and orders prereleases by the semver rules", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0-rc")).toBe(-1);
    expect(compareVersions("1.0.0-rc.1", "1.0.1-alpha")).toBe(-1);
  });

  it("is null when either side is malformed", () => {
    expect(compareVersions("junk", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "")).toBeNull();
    expect(isOlder("junk", "1.0.0")).toBe(false);
    expect(isOlder("1.0.0", "junk")).toBe(false);
  });
});

describe("versionInRange", () => {
  it("matches one comparator", () => {
    expect(versionInRange("1.1.9", "<1.2.0")).toBe(true);
    expect(versionInRange("1.2.0", "<1.2.0")).toBe(false);
    expect(versionInRange("1.2.0", "<=1.2.0")).toBe(true);
    expect(versionInRange("1.2.1", ">1.2.0")).toBe(true);
    expect(versionInRange("1.2.0", ">1.2.0")).toBe(false);
    expect(versionInRange("1.2.0", ">=1.2.0")).toBe(true);
  });

  it("treats a bare version and = as equality, ignoring build metadata", () => {
    expect(versionInRange("1.2.0", "1.2.0")).toBe(true);
    expect(versionInRange("1.2.0+abc.20260101", "=1.2.0")).toBe(true);
    expect(versionInRange("1.2.1", "=1.2.0")).toBe(false);
  });

  it("needs every comparator of a set", () => {
    expect(versionInRange("1.1.0", ">=1.0.0 <1.2.3")).toBe(true);
    expect(versionInRange("1.0.0", ">=1.0.0 <1.2.3")).toBe(true);
    expect(versionInRange("1.2.3", ">=1.0.0 <1.2.3")).toBe(false);
    expect(versionInRange("0.9.9", ">=1.0.0 <1.2.3")).toBe(false);
  });

  it("matches any set of an || range", () => {
    expect(versionInRange("2.0.0", ">=1.0.0 <1.2.3 || =2.0.0")).toBe(true);
    expect(versionInRange("1.5.0", ">=1.0.0 <1.2.3 || =2.0.0")).toBe(false);
    expect(versionInRange("0.1.0", "<0.2.0 || >=3.0.0")).toBe(true);
    expect(versionInRange("3.1.0", "<0.2.0 || >=3.0.0")).toBe(true);
  });

  it("tolerates extra spaces", () => {
    expect(versionInRange("1.1.0", "  >=1.0.0   <1.2.0  ")).toBe(true);
    expect(versionInRange("1.1.0", "<1.0.0  ||  >=1.1.0")).toBe(true);
  });

  it("orders a prerelease below the bound's release", () => {
    expect(versionInRange("1.2.0-rc.1", "<1.2.0")).toBe(true);
    expect(versionInRange("1.2.0-rc.1", ">=1.2.0")).toBe(false);
  });

  it("is false for a malformed version", () => {
    expect(versionInRange("junk", "<2.0.0")).toBe(false);
    expect(versionInRange("", "<2.0.0")).toBe(false);
  });

  it.each(["", " ", "<", "<>1.0.0", "~1.0.0", "^1.0.0", "1.x", "<1.0", "1.0.0 ||", "|| 1.0.0", ">= 1.0.0", "<1.0.0 || junk", "===1.0.0", "=<1.0.0"])(
    "is false for the malformed range %j, even when another part would match",
    (range) => {
      expect(versionInRange("0.0.1", range)).toBe(false);
    },
  );
});
