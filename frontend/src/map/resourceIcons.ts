/**
 * The map's resource-node icons (#571, reversing #330's "no game art"): the game's own textures,
 * 64x64 WebP in public/game-assets/resources/ (licence boundary in that folder's NOTICE.md).
 * FRM's resource `Name` is the key; a name that isn't here keeps the plain circle.
 */
const ICON_DIR = "/game-assets/resources";

/** FRM `Name` to file slug. A Map: names come from the game server. */
const SLUG_BY_NAME = new Map<string, string>([
  ["Iron Ore", "iron-ore"],
  ["Copper Ore", "copper-ore"],
  ["Caterium Ore", "caterium-ore"],
  ["Bauxite", "bauxite"],
  ["Limestone", "limestone"],
  ["Coal", "coal"],
  ["Sulfur", "sulfur"],
  ["Uranium", "uranium"],
  ["SAM", "sam"],
  ["Crude Oil", "crude-oil"],
  ["Water", "water"],
  ["Raw Quartz", "raw-quartz"],
  ["Nitrogen Gas", "nitrogen-gas"],
]);
const GEYSER_SLUG = "geyser";

/** The icon URL for a node, or undefined when its type is unknown. A geyser is drawn by its `nodeType`, whatever it is named. */
export function resourceIconUrl(type: string, nodeType: string): string | undefined {
  const slug = nodeType === "geyser" ? GEYSER_SLUG : SLUG_BY_NAME.get(type);
  return slug === undefined ? undefined : `${ICON_DIR}/${slug}.webp`;
}

/** Every slug the table can return, for the test that checks each file exists. */
export const RESOURCE_ICON_SLUGS: readonly string[] = [...SLUG_BY_NAME.values(), GEYSER_SLUG];
