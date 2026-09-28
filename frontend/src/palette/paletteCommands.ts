import type { FactoryResponse, PowerResponse } from "@satisfactory-dash/shared";
import { formatMW } from "../format";
import { circuitLink, factorySearchLink, itemHistoryLink } from "../lib/deepLinks";
import { labelFor, type ItemLabel } from "../factory/itemLabels";

/** One thing the command bar can do: go somewhere, or run an action. */
export interface PaletteCommand {
  /** Unique within the list; also cmdk's value, so it must be stable. */
  id: string;
  label: string;
  /** A short muted line after the label ("3,633 MW", "12 machines"). */
  hint?: string;
  /** Extra words that should match (a recipe for a machine, a class name for an item). */
  keywords?: string[];
  to?: string;
  action?: "changeServer";
}

export interface PaletteGroup {
  heading: string;
  commands: PaletteCommand[];
}

/** Ctrl+K, or Cmd+K on a Mac (with no other modifier, so Ctrl+Shift+K stays the browser's). */
export function isPaletteShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

/**
 * How well a command matches what was typed, for cmdk's `filter` (0 hides it). Every typed word must
 * appear in the command's words (its label first, then its keywords); a label starting with the
 * first word ranks first, then any label word starting with it. cmdk's default scoring matched
 * scattered letters, so "circuit" found "Empty Canister" (the ui review).
 */
export function paletteScore(search: string, words: readonly string[]): number {
  const typed = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (typed.length === 0) return 1;
  const haystack = words.join(" ").toLowerCase();
  if (!typed.every((word) => haystack.includes(word))) return 0;
  const label = (words[0] ?? "").toLowerCase();
  if (label.startsWith(typed[0])) return 1;
  if (label.split(/[\s·:]+/).some((word) => word.startsWith(typed[0]))) return 0.8;
  return 0.5;
}

/** The most machines listed: they're grouped by name and recipe, so a big factory stays short. */
export const MAX_MACHINES = 200;

export interface PaletteInput {
  /** The operator (the server list's canManageServers): the Servers page. */
  isOperator: boolean;
  serverCount: number;
  /** Cached reads only; missing while not loaded, and their groups are then left out. */
  power?: PowerResponse;
  factory?: FactoryResponse;
  labels: Map<string, ItemLabel>;
}

/**
 * Everything the command bar (#351) offers for the selected server, from data already on hand.
 * Pure, so it's tested without the dialog; the dialog does the matching (cmdk).
 */
export function paletteGroups({ isOperator, serverCount, power, factory, labels }: PaletteInput): PaletteGroup[] {
  const groups: PaletteGroup[] = [];

  groups.push({
    heading: "Pages",
    commands: [
      { id: "page-overview", label: "Overview", to: "/app" },
      { id: "page-power", label: "Power", to: "/app/power" },
      { id: "page-factory", label: "Factory", to: "/app/factory" },
      { id: "page-map", label: "Map", to: "/app/map" },
      { id: "page-settings", label: "Settings", to: "/app/settings" },
      ...(isOperator ? [{ id: "page-servers", label: "Servers", to: "/app/servers" }] : []),
    ],
  });

  groups.push({
    heading: "Settings",
    commands: [
      { id: "settings-auto-pause", label: "Auto-pause", keywords: ["pause", "players"], to: "/app/settings" },
      { id: "settings-agent", label: "Game PC agent", keywords: ["enrol", "enroll", "code", "revoke"], to: "/app/settings#agent" },
      { id: "settings-alerts", label: "Alerts", keywords: ["discord", "webhook", "mute", "rules"], to: "/app/settings#alerts" },
    ],
  });

  if (serverCount > 1) {
    groups.push({ heading: "Servers", commands: [{ id: "change-server", label: "Change server", action: "changeServer" }] });
  }

  const circuits = power?.data.circuits ?? [];
  if (circuits.length > 0) {
    groups.push({
      heading: "Circuits",
      commands: [...circuits]
        .sort((a, b) => a.circuitGroupId - b.circuitGroupId)
        .map((c) => ({
          id: `circuit-${c.circuitGroupId}`,
          label: `Circuit ${c.circuitGroupId}`,
          hint: `${formatMW(c.productionMW)} of ${formatMW(c.capacityMW)}`,
          to: circuitLink(c.circuitGroupId),
        })),
    });
  }

  const buildings = factory?.data.buildings ?? [];
  if (buildings.length > 0) {
    // One entry per machine name and recipe ("Smelter · Iron Ingot", 12 of them): its link searches
    // the table for the recipe, or the name when it has none.
    const byKind = new Map<string, { name: string; recipe: string | null; count: number }>();
    for (const b of buildings) {
      const key = `${b.name}\u0000${b.recipe ?? ""}`;
      const kind = byKind.get(key);
      if (kind) kind.count += 1;
      else byKind.set(key, { name: b.name, recipe: b.recipe, count: 1 });
    }
    const kinds = [...byKind.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || (a.recipe ?? "").localeCompare(b.recipe ?? ""))
      .slice(0, MAX_MACHINES);
    groups.push({
      heading: "Machines",
      commands: kinds.map((k, i) => ({
        id: `machine-${i}-${k.name}-${k.recipe ?? ""}`,
        label: k.recipe ? `${k.name} · ${k.recipe}` : k.name,
        hint: k.count === 1 ? "1 machine" : `${k.count} machines`,
        keywords: [k.name, ...(k.recipe ? [k.recipe] : [])],
        // `||`, not `??`: an empty-string recipe (a valid value per the schema) means "no recipe"
        // just like null does, and the label above already treats it that way.
        to: factorySearchLink(k.recipe || k.name),
      })),
    });
  }

  if (labels.size > 0) {
    groups.push({
      heading: "Items",
      commands: [...labels.keys()]
        .map((itemClass) => ({ itemClass, name: labelFor(labels, itemClass).name }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ itemClass, name }) => ({
          id: `item-${itemClass}`,
          label: name,
          hint: "production history",
          keywords: [itemClass],
          to: itemHistoryLink(itemClass),
        })),
    });
  }

  return groups;
}
