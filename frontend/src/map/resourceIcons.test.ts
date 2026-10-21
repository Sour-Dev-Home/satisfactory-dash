import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESOURCE_ICON_SLUGS, resourceIconUrl } from "./resourceIcons";

describe("resourceIconUrl", () => {
  it("maps FRM's resource names to their icon", () => {
    expect(resourceIconUrl("Iron Ore", "node")).toBe("/game-assets/resources/iron-ore.webp");
    expect(resourceIconUrl("Crude Oil", "frackingSatellite")).toBe("/game-assets/resources/crude-oil.webp");
    expect(resourceIconUrl("SAM", "node")).toBe("/game-assets/resources/sam.webp");
  });

  it("draws a geyser by its node type, whatever its name", () => {
    expect(resourceIconUrl("Geothermal", "geyser")).toBe("/game-assets/resources/geyser.webp");
  });

  it("has no icon for an unknown name, including names that are Object.prototype keys", () => {
    expect(resourceIconUrl("Unobtainium", "node")).toBeUndefined();
    expect(resourceIconUrl("constructor", "node")).toBeUndefined();
    expect(resourceIconUrl("__proto__", "node")).toBeUndefined();
  });

  it("has a file in public/ for every slug", () => {
    for (const slug of RESOURCE_ICON_SLUGS) {
      expect(existsSync(join(import.meta.dirname, "..", "..", "public", "game-assets", "resources", `${slug}.webp`)), slug).toBe(true);
    }
  });
});
