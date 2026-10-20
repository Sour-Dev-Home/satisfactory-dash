/**
 * The app's own preferences, beside settings.json but apart from it, since they exist before a server folder is
 * chosen: Start with Windows (off by default) and whether the hidden-to-tray note was shown.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const PREFERENCES_FILE = "preferences.json";

const schema = z.strictObject({
  startWithWindows: z.boolean().default(false),
  closeNoteShown: z.boolean().default(false),
});

export type Preferences = z.output<typeof schema>;

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({ startWithWindows: false, closeNoteShown: false });

/** The saved preferences, or the defaults when the file is missing, unreadable or invalid. */
export function loadPreferences(dir: string): Preferences {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(join(dir, PREFERENCES_FILE), "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // Missing or not JSON: the defaults.
  }
  return { ...DEFAULT_PREFERENCES };
}

/** Validates, then writes through a temp file and a rename. */
export function savePreferences(dir: string, prefs: Preferences): void {
  const valid = schema.parse(prefs);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, PREFERENCES_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(valid, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
