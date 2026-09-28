/** FRM's NodeType, camelCased, for the M1 contract's `nodeType` (architect follow-up on #367). Every
 *  known value maps explicitly (documented correctness, not left to the generic algorithm below,
 *  even though it happens to agree for these three): a live server's `getResourceNode` returns
 *  `"Node"`, `"Fracking Satellite"` and `"Geyser"` (the last explains why `getResourceGeyser`
 *  answers `[]` — geysers arrive through this endpoint instead, docs-vault/wiki/frm-endpoint-volumes.md). */
const KNOWN_NODE_TYPES: Readonly<Record<string, string>> = {
  Node: "node",
  "Fracking Satellite": "frackingSatellite",
  Geyser: "geyser",
};

/** "Some New Type" -> "someNewType": the first word lowercased, every later word capitalized, no
 *  spaces. A gap in KNOWN_NODE_TYPES should never fail a whole ingest (the M1 contract's `nodeType`
 *  is a plain string, deploy skew) — this keeps the output on one casing convention regardless. */
function genericCamelCase(value: string): string {
  const words = value.trim().split(/\s+/).filter((word) => word.length > 0);
  // No words (empty or all-whitespace input): "" either way, not the original untrimmed value —
  // every other path here normalizes, so this one does too (test-hunter finding, #367 follow-up).
  if (words.length === 0) return "";
  return words.map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join("");
}

export function mapNodeType(raw: string): string {
  // Object.hasOwn, not a plain KNOWN_NODE_TYPES[raw] lookup (architect follow-up, same bug class as
  // #361's registry bypass): KNOWN_NODE_TYPES is a plain object, so raw === "constructor" or
  // "toString" would otherwise resolve to an inherited Object.prototype FUNCTION, not undefined —
  // returning a function where the M1 contract expects a string, which fails M3's schema and takes
  // the whole layer down, the opposite of this file's own conform-don't-reject rule.
  return Object.hasOwn(KNOWN_NODE_TYPES, raw) ? KNOWN_NODE_TYPES[raw]! : genericCamelCase(raw);
}
