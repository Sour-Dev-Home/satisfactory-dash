import { useCallback, useState } from "react";

/**
 * The planner canvas's per-viewer choices (ADR-0055 Decision 6): whether storage is drawn in detail, and whether the
 * transport glyphs move. Kept in this browser only. Storage can be missing, throw (private mode, blocked site data) or
 * hold anything (hand edits): every read and write is in a try/catch, what is read is validated, and a bad value is the
 * default.
 */
export const STORAGE_DETAIL_KEY = "planner.storageDetail";
export const MOTION_KEY = "planner.motion";

export type MotionPref = "system" | "on" | "off";
export const MOTION_OPTIONS: readonly { value: MotionPref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

/** Inside an opened factory the buffers and storages are drawn (the owner's default); the toggle folds them away. */
export const DEFAULT_STORAGE_DETAIL = true;
export const DEFAULT_MOTION: MotionPref = "system";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked site data: the choice holds for this visit only.
  }
}

export function readStorageDetail(): boolean {
  const raw = read(STORAGE_DETAIL_KEY);
  return raw === "on" ? true : raw === "off" ? false : DEFAULT_STORAGE_DETAIL;
}

export const writeStorageDetail = (on: boolean): void => write(STORAGE_DETAIL_KEY, on ? "on" : "off");

export function readMotion(): MotionPref {
  const raw = read(MOTION_KEY);
  return raw === "on" || raw === "off" || raw === "system" ? raw : DEFAULT_MOTION;
}

export const writeMotion = (pref: MotionPref): void => write(MOTION_KEY, pref);

/**
 * The item-focus feature flag (ADR-0060 Decision 2, owner answer 6): focusing a link's item bubble, with keyboard and
 * pointer, ships off until the owner reviews it on the demo (build PR 6), which then removes this flag. Only "on" turns it
 * on; there is no control for it in the UI.
 */
export const ITEM_FOCUS_KEY = "planner.itemFocus";

export const readItemFocus = (): boolean => read(ITEM_FOCUS_KEY) === "on";

export const COLLAPSED_KEY = "planner.collapsed";
/** At most this many collapsed cards are kept, each key at most this long: a hand-edited value cannot grow without bound. */
export const MAX_COLLAPSED = 200;
export const MAX_KEY_CHARS = 200;

/** The cards whose upstream the viewer hid: a JSON array of keys; anything else reads as none. */
export function readCollapsed(): ReadonlySet<string> {
  const raw = read(COLLAPSED_KEY);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === "string" && k.length <= MAX_KEY_CHARS).slice(0, MAX_COLLAPSED));
  } catch {
    return new Set();
  }
}

export const writeCollapsed = (keys: ReadonlySet<string>): void => write(COLLAPSED_KEY, JSON.stringify([...keys].slice(-MAX_COLLAPSED)));

/** A preference held in state, read once on mount and written through on every change. */
function usePref<T>(readValue: () => T, writeValue: (value: T) => void): [T, (value: T) => void] {
  const [value, setValue] = useState(readValue);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      writeValue(next);
    },
    [writeValue],
  );
  return [value, set];
}

export const useStorageDetail = () => usePref(readStorageDetail, writeStorageDetail);
export const useMotionPref = () => usePref(readMotion, writeMotion);
export const useCollapsedUpstream = () => usePref<ReadonlySet<string>>(readCollapsed, writeCollapsed);

/** Whether the transport glyphs move: an explicit choice wins, and System follows the operator's reduced-motion setting. */
export const motionOn = (pref: MotionPref, reducedMotion: boolean): boolean => (pref === "system" ? !reducedMotion : pref === "on");
