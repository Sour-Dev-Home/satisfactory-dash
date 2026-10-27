import { describe, expect, it, vi } from "vitest";
import { clearFoldMemory, FOLDS_KEY, FOLDS_MAX, readFolds, writeFolds } from "./foldMemory";

const folds = (flipped: string[], unfolded: string[] = []) => ({ flipped: new Set(flipped), unfolded: new Set(unfolded) });

describe("fold memory", () => {
  it("starts empty, and remembers each factory's folds apart", () => {
    expect(readFolds("a").flipped.size).toBe(0);
    writeFolds("a", folds(["b1"], ["f1"]));
    writeFolds("b", folds(["b2"]));
    expect([...readFolds("a").flipped]).toEqual(["b1"]);
    expect([...readFolds("a").unfolded]).toEqual(["f1"]);
    expect([...readFolds("b").flipped]).toEqual(["b2"]);
  });

  it("survives a reload of the tab through sessionStorage", () => {
    writeFolds("a", folds(["b1"]));
    clearFoldMemory();
    expect([...readFolds("a").flipped]).toEqual(["b1"]);
  });

  it("forgets a factory whose folds are back to the defaults", () => {
    writeFolds("a", folds(["b1"]));
    writeFolds("a", folds([]));
    clearFoldMemory();
    expect(readFolds("a").flipped.size).toBe(0);
    expect(window.sessionStorage.getItem(FOLDS_KEY)).toBe("[]");
  });

  it(`keeps the ${FOLDS_MAX} most recent factories, dropping the oldest`, () => {
    for (let i = 0; i <= FOLDS_MAX; i++) writeFolds(`f${i}`, folds(["x"]));
    // Touching f1 makes it newest, so f2 goes next.
    writeFolds("f1", folds(["y"]));
    writeFolds("extra", folds(["x"]));
    clearFoldMemory();
    expect(readFolds("f0").flipped.size).toBe(0);
    expect(readFolds("f2").flipped.size).toBe(0);
    expect([...readFolds("f1").flipped]).toEqual(["y"]);
    expect(readFolds("extra").flipped.size).toBe(1);
  });

  it("ignores what it cannot read: bad JSON, the wrong shape, non-string keys", () => {
    for (const raw of ["{not json", JSON.stringify({ a: 1 }), JSON.stringify([[1, {}], ["a", null], ["b", { flipped: [1, "ok"], unfolded: "no" }]])]) {
      window.sessionStorage.setItem(FOLDS_KEY, raw);
      clearFoldMemory();
      expect(readFolds("a").flipped.size).toBe(0);
    }
    expect([...readFolds("b").flipped]).toEqual(["ok"]);
    expect(readFolds("b").unfolded.size).toBe(0);
  });

  it("holds the choices in memory when sessionStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    writeFolds("a", folds(["b1"]));
    expect([...readFolds("a").flipped]).toEqual(["b1"]);
    spy.mockRestore();
  });
});
