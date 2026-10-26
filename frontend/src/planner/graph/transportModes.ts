/** The size of a transport glyph on the canvas (a 24 x 24 box centred on the origin) and the disc behind it. */
export const GLYPH_SIZE = 24;
export const GLYPH_HALO_RADIUS = 14;

/** The modes with a drawn glyph (ADR-0055 Decision 6); the canvas legend lists the ones a scene uses, in this order. */
export const GLYPH_MODES: readonly string[] = ["train", "truck", "drone", "depot"];
