import { describe, expect, it } from "vitest";
import { P, T, C1, treeWorld, treeId, AUTO_KEY } from "../test/plannerTree";
import { buildFactoryTree, designatedKeyOf, ownKeyOf, pathBelow } from "./factoryTree";

// Hunt: pathBelow with keys from the wrong level (ADR-0061 Decision 5).

describe("pathBelow, hunt", () => {
  const { graph, designations } = treeWorld();
  const tree = buildFactoryTree(graph, designations);
  const top = designatedKeyOf(T);
  const mid = designatedKeyOf(P);

  it("a card that is an ancestor of the level (or the level itself) comes back alone", () => {
    expect(pathBelow(tree, mid, top)).toEqual([top]);
    expect(pathBelow(tree, mid, mid)).toEqual([mid]);
  });

  it("a grandchild of a level two up is the whole chain; an own-machines card sits one below its parent", () => {
    expect(pathBelow(tree, top, designatedKeyOf(C1))).toEqual([mid, designatedKeyOf(C1)]);
    expect(pathBelow(tree, null, ownKeyOf(mid))).toEqual([top, mid, ownKeyOf(mid)]);
  });

  it("an empty or foreign key, and a top-level auto factory from a nested level, come back alone", () => {
    expect(pathBelow(tree, null, "")).toEqual([""]);
    expect(pathBelow(tree, top, designatedKeyOf(treeId(99)))).toEqual([designatedKeyOf(treeId(99))]);
    expect(pathBelow(tree, top, AUTO_KEY)).toEqual([AUTO_KEY]);
  });

  it("a level that is not a key of the tree reaches nothing but the card itself", () => {
    expect(pathBelow(tree, "no such level", mid)).toEqual([mid]);
  });
});
