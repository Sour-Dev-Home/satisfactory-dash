import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSED_KEY,
  DEFAULT_MOTION,
  MAX_COLLAPSED,
  MAX_KEY_CHARS,
  MOTION_KEY,
  STORAGE_DETAIL_KEY,
  motionOn,
  readCollapsed,
  readMotion,
  readStorageDetail,
  useCollapsedUpstream,
  useMotionPref,
  useStorageDetail,
  writeCollapsed,
  writeMotion,
  writeStorageDetail,
} from "./plannerPrefs";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the storage detail preference", () => {
  it("is on until the viewer turns it off, and remembers the choice", () => {
    expect(readStorageDetail()).toBe(true);
    writeStorageDetail(false);
    expect(window.localStorage.getItem(STORAGE_DETAIL_KEY)).toBe("off");
    expect(readStorageDetail()).toBe(false);
    writeStorageDetail(true);
    expect(readStorageDetail()).toBe(true);
  });

  it("takes anything else that was stored for the default", () => {
    for (const junk of ["", "yes", "ON", "{}", "null", "1"]) {
      window.localStorage.setItem(STORAGE_DETAIL_KEY, junk);
      expect(readStorageDetail()).toBe(true);
    }
  });

  it("is held in a hook that writes through", () => {
    const { result } = renderHook(() => useStorageDetail());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(STORAGE_DETAIL_KEY)).toBe("off");
    expect(renderHook(() => useStorageDetail()).result.current[0]).toBe(false);
  });
});

describe("the motion preference", () => {
  it("is System until chosen, and keeps only the three known values", () => {
    expect(readMotion()).toBe(DEFAULT_MOTION);
    for (const pref of ["on", "off", "system"] as const) {
      writeMotion(pref);
      expect(window.localStorage.getItem(MOTION_KEY)).toBe(pref);
      expect(readMotion()).toBe(pref);
    }
    for (const junk of ["", "true", "reduced", "__proto__", "On"]) {
      window.localStorage.setItem(MOTION_KEY, junk);
      expect(readMotion()).toBe("system");
    }
  });

  it("follows the operator's reduced-motion setting under System, and obeys an explicit choice", () => {
    expect(motionOn("system", false)).toBe(true);
    expect(motionOn("system", true)).toBe(false);
    expect(motionOn("on", true)).toBe(true);
    expect(motionOn("off", false)).toBe(false);
  });

  it("is held in a hook that writes through", () => {
    const { result } = renderHook(() => useMotionPref());
    act(() => result.current[1]("off"));
    expect(result.current[0]).toBe("off");
    expect(window.localStorage.getItem(MOTION_KEY)).toBe("off");
  });
});

describe("the collapsed-upstream preference", () => {
  it("is empty until a card is collapsed, and round-trips a set", () => {
    expect(readCollapsed().size).toBe(0);
    writeCollapsed(new Set(["a", "b"]));
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('["a","b"]');
    expect([...readCollapsed()]).toEqual(["a", "b"]);
  });

  it("reads anything malformed as none, and keeps only short string keys", () => {
    for (const junk of ["", "not json", "{}", "null", '"a"', "42", '{"a":1}']) {
      window.localStorage.setItem(COLLAPSED_KEY, junk);
      expect(readCollapsed().size).toBe(0);
    }
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["ok", 3, null, { k: 1 }, "x".repeat(MAX_KEY_CHARS + 1), "__proto__"]));
    expect([...readCollapsed()]).toEqual(["ok", "__proto__"]);
  });

  it("caps the set it reads and writes", () => {
    const many = Array.from({ length: MAX_COLLAPSED + 50 }, (_, i) => `k${i}`);
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(many));
    expect(readCollapsed().size).toBe(MAX_COLLAPSED);
    writeCollapsed(new Set(many));
    expect(JSON.parse(window.localStorage.getItem(COLLAPSED_KEY)!)).toHaveLength(MAX_COLLAPSED);
  });

  it("is held in a hook that writes through", () => {
    const { result } = renderHook(() => useCollapsedUpstream());
    act(() => result.current[1](new Set(["n1"])));
    expect(result.current[0].has("n1")).toBe(true);
    expect(renderHook(() => useCollapsedUpstream()).result.current[0].has("n1")).toBe(true);
  });
});

describe("storage that is missing or throws", () => {
  it("reads the defaults and drops writes without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(readStorageDetail()).toBe(true);
    expect(readMotion()).toBe("system");
    expect(readCollapsed().size).toBe(0);
    expect(() => writeCollapsed(new Set(["a"]))).not.toThrow();
    expect(() => writeStorageDetail(false)).not.toThrow();
    expect(() => writeMotion("off")).not.toThrow();
    const { result } = renderHook(() => useMotionPref());
    act(() => result.current[1]("on"));
    expect(result.current[0]).toBe("on");
  });
});
