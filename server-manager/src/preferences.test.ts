import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, loadPreferences, PREFERENCES_FILE, savePreferences } from "./preferences";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-prefs-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("preferences", () => {
  it("default to Start with Windows off and the close note not shown yet", () => {
    expect(DEFAULT_PREFERENCES).toEqual({ startWithWindows: false, closeNoteShown: false });
    expect(loadPreferences(dir)).toEqual(DEFAULT_PREFERENCES);
  });

  it("round-trip through the file", () => {
    savePreferences(join(dir, "new"), { startWithWindows: true, closeNoteShown: true });
    expect(loadPreferences(join(dir, "new"))).toEqual({ startWithWindows: true, closeNoteShown: true });
  });

  it("fall back to the defaults for an invalid or unreadable file", () => {
    for (const text of ["{", "[]", '{"startWithWindows":"yes"}', '{"startWithWindows":true,"extra":1}']) {
      writeFileSync(join(dir, PREFERENCES_FILE), text);
      expect(loadPreferences(dir)).toEqual(DEFAULT_PREFERENCES);
    }
  });

  it("fill a missing field with its default", () => {
    writeFileSync(join(dir, PREFERENCES_FILE), '{"closeNoteShown":true}');
    expect(loadPreferences(dir)).toEqual({ startWithWindows: false, closeNoteShown: true });
  });

  it("refuse to save a non-boolean", () => {
    expect(() => savePreferences(dir, { startWithWindows: "yes" } as never)).toThrow();
    expect(() => readFileSync(join(dir, PREFERENCES_FILE))).toThrow();
  });
});
