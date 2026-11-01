import { describe, expect, it } from "vitest";
import { NOT_PRODUCING, stalledOf, stalledStateText } from "./plannerText";

describe("stalledOf", () => {
  it("names the one state a group's machines share when it has a mark", () => {
    expect(stalledOf({ backedUp: 3 })).toBe("backedUp");
    expect(stalledOf({ underfed: 2, producing: 0 })).toBe("underfed");
    expect(stalledOf({ paused: 1 })).toBe("paused");
    expect(stalledOf({ idle: 4 })).toBe("idle");
  });

  it("has no mark where the words say 'not producing', 'unpowered' or a state this build doesn't know", () => {
    const cases: Record<string, number>[] = [{}, { producing: 2 }, { underfed: 1, backedUp: 1 }, { backedUp: 1, producing: 1 }, { unpowered: 2 }, { warpDrive: 1 }];
    for (const counts of cases) {
      expect(stalledOf(counts)).toBeUndefined();
    }
  });

  it("ignores zero, negative and NaN counts, as the words do", () => {
    expect(stalledOf({ backedUp: 2, paused: 0, idle: -1, underfed: Number.NaN })).toBe("backedUp");
  });

  it("is safe on inherited object keys and a null-prototype map", () => {
    expect(stalledOf({ toString: 1 })).toBeUndefined();
    const counts = Object.create(null) as Record<string, number>;
    counts.paused = 2;
    expect(stalledOf(counts)).toBe("paused");
  });

  it("agrees with stalledStateText: a mark exactly when the words name a marked state", () => {
    const word = new Map([
      ["backedUp", "backed up"],
      ["underfed", "underfed"],
      ["paused", "paused"],
      ["idle", "idle"],
    ]);
    const cases: Record<string, number>[] = [
      {},
      { producing: 1 },
      { backedUp: 1 },
      { underfed: 5 },
      { paused: 2 },
      { idle: 3 },
      { unpowered: 1 },
      { mystery: 1 },
      { idle: 1, paused: 1 },
      { backedUp: 2, producing: 0, idle: 0 },
    ];
    for (const counts of cases) {
      const kind = stalledOf(counts);
      const text = stalledStateText(counts);
      if (kind === undefined) expect([...word.values()]).not.toContain(text);
      else expect(text).toBe(word.get(kind));
      if (text === NOT_PRODUCING) expect(kind).toBeUndefined();
    }
  });
});
