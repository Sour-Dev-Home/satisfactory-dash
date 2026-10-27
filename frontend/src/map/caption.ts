/** "a", "a and b", "a, b and c". */
export function listInWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The layers as the map's caption names them, in order: each by its own `caption` noun when it has one
 * ("players' markers"), else its label in lower case. MapPanel builds its caption from its layer list with this,
 * so a new layer joins the sentence without anyone editing it.
 */
export function captionLayers(layers: readonly { label: string; caption?: string }[]): string {
  return listInWords(layers.map((l) => l.caption ?? l.label.toLowerCase()));
}
