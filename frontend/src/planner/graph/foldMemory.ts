import { useCallback, useRef, useState } from "react";

/**
 * Which bubbles and folds a viewer opened or closed in each factory, and which group cards they opened into their
 * machines, for the session (the owner, 2026-10-27: "Factories
 * forget your collapse all choices when go from all factories back to it ... cache it"). Going back to the overview
 * unmounts the canvas, so the choices live here, keyed by the opened factory's (or site's) key: in memory, mirrored to
 * sessionStorage so a reload of the same tab keeps them. Nothing reaches the backend. sessionStorage can be missing, throw
 * or hold anything (hand edits): every read and write is in a try/catch, and what is read is validated.
 */
export const FOLDS_KEY = "planner.folds";
/** At most this many factories are remembered; the oldest choice goes first. */
export const FOLDS_MAX = 50;

export interface Folds {
  /** Bubbles whose open state differs from the factory's default. */
  flipped: ReadonlySet<string>;
  /** Folds opened. */
  unfolded: ReadonlySet<string>;
  /** Group cards opened into their machines (absent = none; added after the first two, so an older entry still reads). */
  machines?: ReadonlySet<string>;
}

const EMPTY: Folds = { flipped: new Set(), unfolded: new Set(), machines: new Set() };

/** Newest last, so the first key is the one dropped past `FOLDS_MAX`. */
let memory: Map<string, Folds> | null = null;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function load(): Map<string, Folds> {
  if (memory !== null) return memory;
  memory = new Map();
  try {
    const raw = window.sessionStorage.getItem(FOLDS_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed.slice(-FOLDS_MAX)) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "object" || entry[1] === null) continue;
        const { flipped, unfolded, machines } = entry[1] as { flipped?: unknown; unfolded?: unknown; machines?: unknown };
        memory.set(entry[0], { flipped: new Set(strings(flipped)), unfolded: new Set(strings(unfolded)), machines: new Set(strings(machines)) });
      }
    }
  } catch {
    // Unreadable or blocked: start empty.
  }
  return memory;
}

function save(map: Map<string, Folds>): void {
  try {
    const entries = [...map].map(([key, f]) => [key, { flipped: [...f.flipped], unfolded: [...f.unfolded], machines: [...(f.machines ?? [])] }]);
    window.sessionStorage.setItem(FOLDS_KEY, JSON.stringify(entries));
  } catch {
    // Private mode, quota or blocked site data: the choices hold in memory for this visit.
  }
}

/** The remembered folds for `key`, or none opened or closed. */
export function readFolds(key: string): Folds {
  return load().get(key) ?? EMPTY;
}

/** Remembers `folds` for `key` as the newest; a factory with nothing changed is forgotten. */
export function writeFolds(key: string, folds: Folds): void {
  const map = load();
  map.delete(key);
  if (folds.flipped.size > 0 || folds.unfolded.size > 0 || (folds.machines?.size ?? 0) > 0) map.set(key, folds);
  while (map.size > FOLDS_MAX) map.delete(map.keys().next().value!);
  save(map);
}

/** For tests: forget the in-memory copy, so the next read comes from sessionStorage. */
export function clearFoldMemory(): void {
  memory = null;
}

/**
 * The folds of the factory (or site) `key`, remembered for the session; null (the overview, which has no folds) keeps them
 * in this component only. The canvas is keyed by what is open, so `key` is fixed for a mounted canvas.
 */
export function useFolds(key: string | null): [Folds, (patch: Partial<Folds>) => void] {
  const [folds, setState] = useState<Folds>(() => (key === null ? EMPTY : readFolds(key)));
  // The latest folds, so two patches in one render (each changing a different half) both land.
  const latest = useRef(folds);
  const set = useCallback(
    (patch: Partial<Folds>) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setState(next);
      if (key !== null) writeFolds(key, next);
    },
    [key],
  );
  return [folds, set];
}
