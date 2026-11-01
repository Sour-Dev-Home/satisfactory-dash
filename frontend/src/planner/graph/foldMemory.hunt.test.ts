import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFoldMemory, FOLDS_KEY, overviewFoldsKey, readFolds, writeFolds } from "./foldMemory";

// Hunt: the overview's blow-up memory (ADR-0061 Decision 5, owner answer 5).

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  clearFoldMemory();
});

const blown = (...keys: string[]) => ({ flipped: new Set<string>(), unfolded: new Set<string>(), expanded: new Set(keys) });

describe("overviewFoldsKey", () => {
  it("is one key per path, apart from the top level and from a path that is a prefix", () => {
    const keys = [overviewFoldsKey([]), overviewFoldsKey(["a"]), overviewFoldsKey(["a", "b"]), overviewFoldsKey(["a b"]), overviewFoldsKey(["ab"])];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not collide with a factory key of the forms the planner makes", () => {
    for (const factory of ["factory|auto", "factory|designation|00000000-0000-4000-8000-000000000001", "site|x"]) {
      expect(overviewFoldsKey([])).not.toBe(factory);
      expect(overviewFoldsKey([factory])).not.toBe(factory);
    }
  });
});

describe("blow-ups in the fold memory", () => {
  it("remembers each path's blow-ups apart, across a reload", () => {
    writeFolds(overviewFoldsKey([]), blown("a"));
    writeFolds(overviewFoldsKey(["a"]), blown("b"));
    clearFoldMemory();
    expect([...(readFolds(overviewFoldsKey([])).expanded ?? [])]).toEqual(["a"]);
    expect([...(readFolds(overviewFoldsKey(["a"])).expanded ?? [])]).toEqual(["b"]);
    expect(readFolds(overviewFoldsKey(["z"])).expanded?.size).toBe(0);
  });

  it("forgets a level with nothing blown up, so it does not take one of the remembered slots", () => {
    writeFolds(overviewFoldsKey([]), blown("a"));
    writeFolds(overviewFoldsKey([]), blown());
    expect(window.sessionStorage.getItem(FOLDS_KEY)).toBe("[]");
  });

  it("keeps keys of cards that are no longer in the tree without breaking a read (the scene ignores them)", () => {
    writeFolds(overviewFoldsKey([]), blown("gone", "also gone"));
    clearFoldMemory();
    expect(readFolds(overviewFoldsKey([])).expanded?.size).toBe(2);
  });

  it("reads an entry whose expanded is the wrong shape as none", () => {
    window.sessionStorage.setItem(FOLDS_KEY, JSON.stringify([["k", { flipped: [], unfolded: [], expanded: "nope" }], ["j", { flipped: [], unfolded: [], expanded: [1, "ok", null] }]]));
    expect(readFolds("k").expanded?.size).toBe(0);
    expect([...(readFolds("j").expanded ?? [])]).toEqual(["ok"]);
  });

  it("holds in memory when sessionStorage throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => writeFolds(overviewFoldsKey([]), blown("a"))).not.toThrow();
    expect([...(readFolds(overviewFoldsKey([])).expanded ?? [])]).toEqual(["a"]);
  });

  it("starts empty when sessionStorage throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    clearFoldMemory();
    expect(readFolds(overviewFoldsKey([])).expanded?.size).toBe(0);
    expect(() => writeFolds(overviewFoldsKey([]), blown("a"))).not.toThrow();
  });
});
