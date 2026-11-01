import { describe, expect, it } from "vitest";
import { captionLayers, listInWords } from "./caption";

describe("listInWords", () => {
  it("joins with commas and a final 'and'", () => {
    expect(listInWords([])).toBe("");
    expect(listInWords(["rails"])).toBe("rails");
    expect(listInWords(["rails", "trains"])).toBe("rails and trains");
    expect(listInWords(["rails", "resource nodes", "trains"])).toBe("rails, resource nodes and trains");
  });
});

describe("captionLayers", () => {
  it("names each layer by its label in lower case, or by its own caption noun, in order", () => {
    expect(
      captionLayers([
        { label: "Rails" },
        { label: "Belts and pipes" },
        { label: "Markers", caption: "players' markers" },
        { label: "Trains" },
      ]),
    ).toBe("rails, belts and pipes, players' markers and trains");
  });

  it("follows the layer list: a new layer joins the sentence", () => {
    expect(captionLayers([{ label: "Rails" }, { label: "Trains" }, { label: "Drone ports" }])).toBe("rails, trains and drone ports");
  });
});
