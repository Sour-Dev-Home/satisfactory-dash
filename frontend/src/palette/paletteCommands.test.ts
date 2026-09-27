import { describe, expect, it } from "vitest";
import { factoryMixed, powerOk } from "@satisfactory-dash/shared/fixtures";
import { itemLabels } from "../factory/itemLabels";
import { factorySearchLink } from "../lib/deepLinks";
import { isPaletteShortcut, MAX_MACHINES, paletteGroups, type PaletteInput } from "./paletteCommands";

const base: PaletteInput = { isOperator: false, serverCount: 1, labels: new Map() };
const headings = (input: PaletteInput) => paletteGroups(input).map((g) => g.heading);
const group = (input: PaletteInput, heading: string) => paletteGroups(input).find((g) => g.heading === heading);

describe("paletteGroups", () => {
  it("always offers the pages and settings; Servers only to the operator", () => {
    expect(headings(base)).toEqual(["Pages", "Settings"]);
    expect(group(base, "Pages")?.commands.map((c) => c.label)).not.toContain("Servers");
    expect(group({ ...base, isOperator: true }, "Pages")?.commands.map((c) => c.to)).toContain("/app/servers");
    expect(group(base, "Settings")?.commands.map((c) => c.to)).toEqual([
      "/app/settings",
      "/app/settings#agent",
      "/app/settings#alerts",
    ]);
  });

  it("offers Change server only when there's more than one", () => {
    expect(headings({ ...base, serverCount: 2 })).toContain("Servers");
    expect(group({ ...base, serverCount: 2 }, "Servers")?.commands[0]).toMatchObject({ action: "changeServer" });
  });

  it("lists each circuit, linking to its card, in id order", () => {
    const circuits = group({ ...base, power: powerOk }, "Circuits")?.commands ?? [];
    expect(circuits).toHaveLength(powerOk.data.circuits.length);
    const first = powerOk.data.circuits[0];
    expect(circuits[0]).toMatchObject({ label: `Circuit ${first.circuitGroupId}`, to: `/app/power#circuit-${first.circuitGroupId}` });
    expect(circuits[0].hint).toMatch(/ MW of .* MW$/);
  });

  it("lists machines once per name and recipe, with how many, searching the table for the recipe", () => {
    const machines = group({ ...base, factory: factoryMixed }, "Machines")?.commands ?? [];
    const kinds = new Set(factoryMixed.data.buildings.map((b) => `${b.name}|${b.recipe ?? ""}`));
    expect(machines).toHaveLength(kinds.size);
    const withRecipe = factoryMixed.data.buildings.find((b) => b.recipe !== null)!;
    const entry = machines.find((m) => m.label === `${withRecipe.name} · ${withRecipe.recipe}`)!;
    expect(entry.to).toBe(`/app/factory?q=${encodeURIComponent(withRecipe.recipe!).replace(/%20/g, "+")}`);
    expect(entry.hint).toMatch(/^\d+ machines?$/);
  });

  it("caps the machines at MAX_MACHINES for a very large factory", () => {
    const many = {
      ...factoryMixed,
      data: {
        ...factoryMixed.data,
        buildings: Array.from({ length: MAX_MACHINES + 50 }, (_, i) => ({
          ...factoryMixed.data.buildings[0],
          id: `b${i}`,
          recipe: `Recipe ${String(i).padStart(3, "0")}`,
        })),
      },
    };
    expect(group({ ...base, factory: many }, "Machines")?.commands).toHaveLength(MAX_MACHINES);
  });

  it("lists items by name, linking to their production history", () => {
    const labels = itemLabels(factoryMixed.data.buildings);
    const items = group({ ...base, labels }, "Items")?.commands ?? [];
    expect(items).toHaveLength(labels.size);
    const names = items.map((i) => i.label);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(items[0].to).toMatch(/^\/app\/factory\?item=\w+#history$/);
  });

  it("treats an empty-string recipe as no recipe, same as null, for the search link", () => {
    const factory = {
      ...factoryMixed,
      data: {
        ...factoryMixed.data,
        buildings: [{ ...factoryMixed.data.buildings[0], id: "empty-recipe", name: "Blender", recipe: "" }],
      },
    };
    const machines = group({ ...base, factory }, "Machines")?.commands ?? [];
    expect(machines).toHaveLength(1);
    expect(machines[0].label).toBe("Blender");
    expect(machines[0].to).toBe(factorySearchLink("Blender"));
  });

  it("merges a null-recipe and an empty-string-recipe machine of the same name into one group", () => {
    const factory = {
      ...factoryMixed,
      data: {
        ...factoryMixed.data,
        buildings: [
          { ...factoryMixed.data.buildings[0], id: "a", name: "Blender", recipe: null },
          { ...factoryMixed.data.buildings[0], id: "b", name: "Blender", recipe: "" },
        ],
      },
    };
    const machines = group({ ...base, factory }, "Machines")?.commands ?? [];
    expect(machines).toHaveLength(1);
    expect(machines[0].hint).toBe("2 machines");
    expect(machines[0].to).toBe(factorySearchLink("Blender"));
  });

  it("gives every command a unique id (cmdk's value)", () => {
    const labels = itemLabels(factoryMixed.data.buildings);
    const all = paletteGroups({ isOperator: true, serverCount: 2, power: powerOk, factory: factoryMixed, labels }).flatMap(
      (g) => g.commands,
    );
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });
});

describe("isPaletteShortcut", () => {
  const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  it("is Ctrl+K or Cmd+K, either case, and nothing else", () => {
    expect(isPaletteShortcut(key("k", { ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key("K", { metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key("k"))).toBe(false);
    expect(isPaletteShortcut(key("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteShortcut(key("k", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteShortcut(key("j", { ctrlKey: true }))).toBe(false);
  });
});
