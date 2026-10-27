import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ITEM_ICON_CLASSES, ITEM_ICON_SIZES, ITEM_ICON_SLUGS, itemIconText, itemIconUrl } from "./itemIcons";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const DIR = join(ROOT, "frontend", "public", "game-assets", "items");

/** Every item class in the game's own Docs file (game 1.2.4.0), as committed by the backend's item-form catalog. */
const GAME_ITEM_CLASSES = new Set(
  Object.keys(
    (JSON.parse(readFileSync(join(ROOT, "backend", "src", "modules", "telemetry", "itemForms.generated.json"), "utf8")) as {
      forms: Record<string, string>;
    }).forms,
  ),
);

/** Item classes in the captured FRM responses under docs-vault/raw-sources. */
function capturedItemClasses(): string[] {
  const dir = join(ROOT, "docs-vault", "raw-sources", "captured-responses");
  const found = new Set<string>();
  for (const f of readdirSync(dir)) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/\bDesc_[A-Za-z0-9_]+_C\b/g)) found.add(m[0]);
  }
  return [...found].filter((c) => GAME_ITEM_CLASSES.has(c)).sort();
}

/**
 * Captured items the owner's FModel export has no icon for (equipment, ammo, collectibles, Mercer Sphere and
 * Somersloop, the coupon). They get the text fallback. A class here that gains an icon fails the test below, so the
 * list stays honest.
 */
const NO_ICON_YET = new Set([
  "Desc_Berry_C", "Desc_Chainsaw_C", "Desc_Nut_C", "Desc_Parachute_C", "Desc_ResourceSinkCoupon_C", "Desc_Shroom_C",
  "Desc_WAT1_C", "Desc_WAT2_C",
]);

describe("itemIconUrl", () => {
  it("maps an FRM item class to its icon at each size", () => {
    expect(itemIconUrl("Desc_IronPlate_C", 32)).toBe("/game-assets/items/iron-plates-32.webp");
    expect(itemIconUrl("Desc_IronPlate_C", 64)).toBe("/game-assets/items/iron-plates-64.webp");
    expect(itemIconUrl("Desc_IronPlate_C", 128)).toBe("/game-assets/items/iron-plates-128.webp");
    expect(itemIconUrl("Desc_Stone_C", 32)).toBe("/game-assets/items/stone-32.webp");
  });

  it("has no icon for an unknown class, including names that are Object.prototype keys", () => {
    expect(itemIconUrl("Desc_SomethingNew_C", 32)).toBeUndefined();
    expect(itemIconUrl("iron-plates", 64)).toBeUndefined();
    expect(itemIconUrl("__proto__", 64)).toBeUndefined();
    expect(itemIconUrl("constructor", 128)).toBeUndefined();
    expect(itemIconUrl("", 32)).toBeUndefined();
  });

  it("maps only real item classes", () => {
    for (const c of ITEM_ICON_CLASSES) expect(GAME_ITEM_CLASSES.has(c), c).toBe(true);
  });

  it("resolves every captured item class, except the documented ones without art", () => {
    const captured = capturedItemClasses();
    expect(captured.length).toBeGreaterThan(30);
    for (const c of captured) {
      if (NO_ICON_YET.has(c)) expect(itemIconUrl(c, 32), `${c} now has an icon: drop it from NO_ICON_YET`).toBeUndefined();
      else expect(itemIconUrl(c, 32), c).toBeDefined();
    }
  });

  it("has every size of every slug in public/, and no file without a slug", () => {
    expect(ITEM_ICON_SIZES).toEqual([32, 64, 128]);
    const expected = ITEM_ICON_SLUGS.flatMap((s) => ITEM_ICON_SIZES.map((n) => `${s}-${n}.webp`)).sort();
    for (const f of expected) expect(existsSync(join(DIR, f)), f).toBe(true);
    const files = readdirSync(DIR).filter((f) => f !== "NOTICE.md");
    expect(files.sort()).toEqual(expected);
  });

  it("gives each class one slug and each slug one class", () => {
    expect(new Set(ITEM_ICON_CLASSES).size).toBe(ITEM_ICON_CLASSES.length);
    expect(ITEM_ICON_SLUGS.length).toBe(ITEM_ICON_CLASSES.length);
    for (const s of ITEM_ICON_SLUGS) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("itemIconText (the fallback when there is no icon)", () => {
  it("uses the initials of the first two words", () => {
    expect(itemIconText("Iron Plate")).toBe("IP");
    expect(itemIconText("Reinforced Iron Plate")).toBe("RI");
    expect(itemIconText("Wire")).toBe("W");
    expect(itemIconText("iodine-infused filter")).toBe("IF");
  });

  it("skips leading punctuation and keeps non-Latin letters whole", () => {
    expect(itemIconText("(Alpha) beta")).toBe("AB");
    expect(itemIconText("éclair")).toBe("É");
    expect(itemIconText("🍓 Berry")).toBe("B");
  });

  it("is '?' with no usable name, never blank", () => {
    expect(itemIconText(undefined)).toBe("?");
    expect(itemIconText("")).toBe("?");
    expect(itemIconText("   ")).toBe("?");
    expect(itemIconText("--- !!")).toBe("?");
  });
});
