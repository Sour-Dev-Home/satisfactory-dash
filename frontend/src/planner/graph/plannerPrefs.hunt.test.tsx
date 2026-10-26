import { afterEach, describe, expect, it, vi } from "vitest";
import { COLLAPSED_KEY, MAX_COLLAPSED, MAX_KEY_CHARS, MOTION_KEY, STORAGE_DETAIL_KEY, readCollapsed, readMotion, readStorageDetail, writeCollapsed } from "./plannerPrefs";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("plannerPrefs, hunted", () => {
  it("reads defaults when localStorage getter throws or is missing", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStorageDetail()).toBe(true);
    expect(readMotion()).toBe("system");
    expect(readCollapsed().size).toBe(0);
    expect(() => writeCollapsed(new Set(["a"]))).not.toThrow();
  });

  it("junk values read as defaults", () => {
    for (const junk of ["", "ON", "true", "null", "{}", " on"]) {
      window.localStorage.setItem(STORAGE_DETAIL_KEY, junk);
      window.localStorage.setItem(MOTION_KEY, junk);
      expect(readStorageDetail()).toBe(true);
      expect(readMotion()).toBe("system");
    }
  });

  it("collapsed: non-array, nested, non-string, overlong and oversized values are bounded", () => {
    for (const junk of ["{", "null", "42", '"str"', '{"a":1}', "[[]]", "[1,null,{},true]"]) {
      window.localStorage.setItem(COLLAPSED_KEY, junk);
      expect(readCollapsed().size).toBe(0);
    }
    const many = Array.from({ length: MAX_COLLAPSED * 3 }, (_, i) => `k${i}`);
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...many, "x".repeat(MAX_KEY_CHARS + 1)]));
    expect(readCollapsed().size).toBe(MAX_COLLAPSED);
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["x".repeat(MAX_KEY_CHARS + 1), "ok"]));
    expect([...readCollapsed()]).toEqual(["ok"]);
  });

  it("__proto__ and friends are plain members", () => {
    window.localStorage.setItem(COLLAPSED_KEY, '["__proto__","constructor","hasOwnProperty"]');
    const s = readCollapsed();
    expect(s.has("__proto__") && s.has("constructor") && s.has("hasOwnProperty")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("write keeps the most recent MAX_COLLAPSED and round-trips", () => {
    writeCollapsed(new Set(Array.from({ length: MAX_COLLAPSED + 5 }, (_, i) => `k${i}`)));
    const back = readCollapsed();
    expect(back.size).toBe(MAX_COLLAPSED);
    expect(back.has("k204")).toBe(true);
    expect(back.has("k0")).toBe(false);
  });

  it("write survives setItem throwing (quota)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeCollapsed(new Set(["a"]))).not.toThrow();
  });
});
