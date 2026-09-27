import { describe, it, expect } from "vitest";
import { mapNodeType } from "./nodeType.js";

// fresh-eyes pass (architect follow-up on #367): nodeType.ts had no dedicated test file before
// this — only exercised indirectly through resourceNodesMapper.test.ts with 3 known values plus a
// couple of generic-algorithm examples. These target genericCamelCase's edge behavior directly.
describe("mapNodeType / genericCamelCase adversarial inputs", () => {
  it("known values map explicitly, not through the generic algorithm", () => {
    expect(mapNodeType("Node")).toBe("node");
    expect(mapNodeType("Fracking Satellite")).toBe("frackingSatellite");
    expect(mapNodeType("Geyser")).toBe("geyser");
  });

  it("empty string does not throw, and returns the input unchanged (no words to camelCase)", () => {
    expect(mapNodeType("")).toBe("");
  });

  it("an all-whitespace string does not throw, and normalizes to \"\" like an empty string does", () => {
    // Fixed after a fresh-eyes finding: this branch used to return the ORIGINAL untrimmed `value`
    // for a whitespace-only input (e.g. mapNodeType("   ") === "   "), the one path in this
    // function that didn't normalize. Now consistent with the empty-string case.
    expect(mapNodeType("   ")).toBe("");
    expect(mapNodeType("\t\n")).toBe("");
  });

  it("a single character is lowercased, not left upper/mixed case", () => {
    expect(mapNodeType("N")).toBe("n");
  });

  it("multiple consecutive spaces between words collapse exactly like a single space would", () => {
    expect(mapNodeType("Some    New   Type")).toBe("someNewType");
  });

  it("leading and trailing whitespace around an otherwise-known-shaped value is trimmed before camelCasing", () => {
    expect(mapNodeType("  Some New Type  ")).toBe("someNewType");
    // leading/trailing whitespace is NOT part of KNOWN_NODE_TYPES's exact-match keys, so " Node "
    // does not hit the known-value fast path - it still lands on the same output via the generic
    // algorithm, which is the point of having a generic fallback at all.
    expect(mapNodeType(" Node ")).toBe("node");
  });

  it("non-letter characters inside a single word do not throw and are lowercased wholesale", () => {
    expect(mapNodeType("Node-2")).toBe("node-2");
    expect(mapNodeType("123abc")).toBe("123abc");
  });

  it("a word made entirely of non-letter characters does not throw when upper-cased as a later word", () => {
    expect(mapNodeType("Node 123")).toBe("node123");
    expect(mapNodeType("Node !!!")).toBe("node!!!");
  });

  it("unicode letters are handled without throwing, using JS's built-in case conversion", () => {
    expect(mapNodeType("Öre")).toBe("öre");
    expect(mapNodeType("Öre Vein")).toBe("öreVein");
  });

  it("an astral (surrogate-pair) character as the very first character of a later word does not throw", () => {
    // U+1F600 (grinning face emoji) is a surrogate pair in UTF-16; charAt(0) only grabs the high
    // surrogate. This asserts the function completes without throwing and returns a string -
    // documenting actual behavior, not a claim about what the "correct" camelCase of an emoji is.
    expect(() => mapNodeType("Node 😀Satellite")).not.toThrow();
    expect(typeof mapNodeType("Node 😀Satellite")).toBe("string");
  });
});
