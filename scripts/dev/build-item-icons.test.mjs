import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickSources, slugOfTexture, slugsFromTable } from "./build-item-icons.mjs";

test("slugOfTexture kebab-cases the texture name without IconDesc_ and the size", () => {
  assert.equal(slugOfTexture("IconDesc_IronPlates_256.png"), "iron-plates");
  assert.equal(slugOfTexture("IconDesc_AIExpension_256.png"), "ai-expension");
  assert.equal(slugOfTexture("IconDesc_SpelevatorPart_1_256.png"), "spelevator-part-1");
  assert.equal(slugOfTexture("IconDesc_copper_new_256.png"), "copper-new");
  assert.equal(slugOfTexture("IconDesc_GunpowderMk2_256.png"), "gunpowder-mk2");
  assert.equal(slugOfTexture("LiquidOil_Pipe_512.png"), "liquid-oil-pipe");
  assert.equal(slugOfTexture("Stone_256.png"), "stone");
});

test("slugOfTexture ignores files that are not a 256 or 512 px PNG", () => {
  assert.equal(slugOfTexture("IconDesc_IronPlates_64.png"), undefined);
  assert.equal(slugOfTexture("IconDesc_IronPlates_256.uasset"), undefined);
  assert.equal(slugOfTexture("README.md"), undefined);
});

test("pickSources prefers 256 over 512 and rejects two textures with one slug", () => {
  const { bySlug, errors } = pickSources([
    { name: "Oil_512.png", path: "a/Oil_512.png" },
    { name: "Oil_256.png", path: "b/Oil_256.png" },
    { name: "Wire_256.png", path: "c/Wire_256.png" },
    { name: "IconDesc_Wire_256.png", path: "d/IconDesc_Wire_256.png" },
    { name: "notes.txt", path: "e/notes.txt" },
  ]);
  assert.equal(bySlug.get("oil").path, "b/Oil_256.png");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"wire"/);
  assert.equal(bySlug.size, 2);
});

test("slugsFromTable reads the slugs of itemIcons.ts' table, without repeats", () => {
  const src = `const X = 1;\nconst SLUG_BY_CLASS = new Map<string, string>([\n  ["Desc_A_C", "a-b"], // A\n  ["Desc_B_C", "c"],\n  ["Desc_C_C", "a-b"],\n]);\nconst Y = [["x", "y"]];`;
  assert.deepEqual(slugsFromTable(src), ["a-b", "c"]);
  assert.throws(() => slugsFromTable("const Other = 1;"), /not found/);
});

test("the real table parses to as many slugs as it has rows", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "frontend", "src", "planner", "graph", "itemIcons.ts"), "utf8");
  const rows = src.slice(src.indexOf("const SLUG_BY_CLASS")).split("]);")[0].match(/^\s+\["/gm) ?? [];
  assert.equal(slugsFromTable(src).length, rows.length);
});

test("pickSources keeps a lone 512 px texture and rejects two at the same size", () => {
  const one = pickSources([{ name: "Oil_512.png", path: "a/Oil_512.png" }]);
  assert.equal(one.bySlug.get("oil").size, 512);
  assert.equal(one.errors.length, 0);
  const two = pickSources([
    { name: "Oil_512.png", path: "a/Oil_512.png" },
    { name: "IconDesc_Oil_512.png", path: "b/IconDesc_Oil_512.png" },
  ]);
  assert.equal(two.errors.length, 1);
  const late512 = pickSources([
    { name: "Oil_256.png", path: "a/Oil_256.png" },
    { name: "IconDesc_Oil_512.png", path: "b/IconDesc_Oil_512.png" },
  ]);
  assert.equal(late512.bySlug.get("oil").size, 256);
  assert.equal(late512.errors.length, 0);
});

test("slugsFromTable throws on a table with no rows", () => {
  assert.throws(() => slugsFromTable("const SLUG_BY_CLASS = new Map([\n]);"), /empty/);
});
