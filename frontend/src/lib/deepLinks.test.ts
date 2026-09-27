import { describe, expect, it } from "vitest";
import {
  circuitAnchor,
  circuitLink,
  factorySearchLink,
  isCircuitAnchor,
  itemHistoryLink,
  readItem,
  readSearch,
} from "./deepLinks";
import { hashId } from "./useHashTarget";

const params = (query: string) => new URLSearchParams(query);

describe("deep links (#351)", () => {
  it("builds absolute /app links, encoding what the user typed", () => {
    expect(factorySearchLink("Smelter")).toBe("/app/factory?q=Smelter");
    expect(factorySearchLink("iron plate & rod")).toBe("/app/factory?q=iron+plate+%26+rod");
    expect(itemHistoryLink("Desc_IronPlate_C")).toBe("/app/factory?item=Desc_IronPlate_C#history");
    expect(circuitLink(3)).toBe("/app/power#circuit-3");
    expect(circuitAnchor(12)).toBe("circuit-12");
  });

  it("reads back what it builds", () => {
    expect(readSearch(new URL(factorySearchLink("iron plate & rod"), "https://x").searchParams)).toBe("iron plate & rod");
    expect(readItem(new URL(itemHistoryLink("Desc_Wire_C"), "https://x").searchParams)).toBe("Desc_Wire_C");
  });

  it("keeps a search as typed (a space mid-word survives), capped, empty when absent", () => {
    expect(readSearch(params("q=iron%20"))).toBe("iron ");
    expect(readSearch(params(""))).toBe("");
    expect(readSearch(params(`q=${"x".repeat(150)}`))).toHaveLength(100);
  });

  it("accepts only a plausible item class name", () => {
    expect(readItem(params("item=Desc_IronPlate_C"))).toBe("Desc_IronPlate_C");
    expect(readItem(params("item=%20Desc_Wire_C%20"))).toBe("Desc_Wire_C");
    expect(readItem(params(""))).toBeUndefined();
    expect(readItem(params("item="))).toBeUndefined();
    expect(readItem(params("item=%3Cscript%3E"))).toBeUndefined();
    expect(readItem(params("item=Desc Iron"))).toBeUndefined();
    expect(readItem(params(`item=${"A".repeat(201)}`))).toBeUndefined();
  });

  it("recognises only circuit-<number> as a circuit anchor", () => {
    expect(isCircuitAnchor("circuit-3")).toBe(true);
    expect(isCircuitAnchor("circuit-")).toBe(false);
    expect(isCircuitAnchor("circuit-3a")).toBe(false);
    expect(isCircuitAnchor("history")).toBe(false);
  });

  it("reads a fragment's id, and nothing from a missing or malformed one", () => {
    expect(hashId("#circuit-3")).toBe("circuit-3");
    expect(hashId("#caf%C3%A9")).toBe("café");
    expect(hashId("")).toBeUndefined();
    expect(hashId("#")).toBeUndefined();
    expect(hashId("#%E0%A4%A")).toBeUndefined();
  });
});
