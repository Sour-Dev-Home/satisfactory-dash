import { z } from "zod";

/**
 * Parsing of the game's own item data (ADR-0015). Kept apart from itemForms.ts, which
 * imports the generated catalog, so the update script can run before that file exists.
 */
export type ItemForm = "solid" | "fluid";

/** RF_LIQUID and RF_GAS are both measured in m3 in game, so both are "fluid". RF_INVALID
 *  entries (workbenches, buildings and other non-items) are skipped. */
const FORM_BY_RESOURCE_FORM: Record<string, ItemForm | undefined> = {
  RF_SOLID: "solid",
  RF_LIQUID: "fluid",
  RF_GAS: "fluid",
};

const DocsSchema = z.array(
  z.object({
    NativeClass: z.string(),
    Classes: z.array(z.object({ ClassName: z.string(), mForm: z.string().optional() }).loose()),
  }),
);

/** Decodes the Docs file: the game writes UTF-16LE with a BOM. UTF-8 (with or without a
 *  BOM) is accepted too, so a re-saved copy still works. */
export function decodeDocsFile(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const body = bytes.subarray(2);
    if (body.length % 2 !== 0) {
      throw new Error("The Docs file is truncated (UTF-16 needs an even number of bytes).");
    }
    return body.toString("utf16le");
  }
  const text = bytes.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Every item className -> form in the Docs JSON. Throws when the file isn't the expected
 *  array of { NativeClass, Classes[] }, so a game update that changes the format fails the
 *  script loudly instead of producing an empty catalog. */
export function parseItemForms(docsJson: unknown): Record<string, ItemForm> {
  const parsed = DocsSchema.safeParse(docsJson);
  if (!parsed.success) {
    throw new Error("The Docs file isn't an array of { NativeClass, Classes[] }; did the game's format change?");
  }
  const forms: Record<string, ItemForm> = {};
  for (const group of parsed.data) {
    for (const item of group.Classes) {
      const form = item.mForm === undefined ? undefined : FORM_BY_RESOURCE_FORM[item.mForm];
      if (form) {
        // The same className with two different forms means the data isn't what we assume
        // (a bad merge, or a format change): fail instead of silently keeping the last one.
        if (Object.hasOwn(forms, item.ClassName) && forms[item.ClassName] !== form) {
          throw new Error(`The Docs file gives ${item.ClassName} conflicting forms; not guessing.`);
        }
        forms[item.ClassName] = form;
      }
    }
  }
  return forms;
}
