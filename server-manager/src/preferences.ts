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

/**
 * The saved preferences, field by field: each known field that is a boolean is kept, anything else (a missing or
 * unreadable file, a wrong type, a key a newer build added) falls back to the default for that field only.
 */
export function loadPreferences(dir: string): Preferences {
  const prefs = { ...DEFAULT_PREFERENCES };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, PREFERENCES_FILE), "utf8"));
  } catch {
    return prefs;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return prefs;
  const record = raw as Record<string, unknown>;
  if (Object.hasOwn(record, "startWithWindows") && typeof record.startWithWindows === "boolean") {
    prefs.startWithWindows = record.startWithWindows;
  }
  if (Object.hasOwn(record, "closeNoteShown") && typeof record.closeNoteShown === "boolean") {
    prefs.closeNoteShown = record.closeNoteShown;
  }
  return prefs;
}

/** Validates, then writes through a temp file and a rename. */
export function savePreferences(dir: string, prefs: Preferences): void {
  const valid = schema.parse(prefs);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, PREFERENCES_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(valid, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
