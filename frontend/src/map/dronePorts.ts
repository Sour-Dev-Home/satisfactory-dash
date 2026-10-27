import type { DronePort } from "@satisfactory-dash/shared";

/**
 * The drone ports' pairings, resolved to ports (ADR-0055 Decision 1, #330). FRM names the partner, not its id, and
 * names may repeat, so a pairing is resolved only when it points at exactly one other port: by `pairedId` when the
 * sender gives one (a native reader), else by the name. Ports are told apart by their index: ids may repeat too.
 */
export interface DronePairings {
  /** Each port's partner, as an index into the ports; null when unpaired or not matched to one port. */
  partner: (number | null)[];
  /** Every route once, as [lower index, higher index], in the order first found. */
  routes: [number, number][];
  /** How many paired ports couldn't be matched to exactly one other port (no route is drawn for them). */
  unmatched: number;
}

/** The indices of the ports per key; a Map, since names and ids come from the game. */
function indexBy(ports: readonly DronePort[], key: (p: DronePort) => string): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let i = 0; i < ports.length; i++) {
    const k = key(ports[i]);
    const list = index.get(k);
    if (list) list.push(i);
    else index.set(k, [i]);
  }
  return index;
}

/** The one port a key names, or null when it names none or more than one. */
const onlyOne = (index: Map<string, number[]>, key: string): number | null => {
  const found = index.get(key);
  return found?.length === 1 ? found[0] : null;
};

export function resolvePairings(ports: readonly DronePort[]): DronePairings {
  const byId = indexBy(ports, (p) => p.id);
  const byName = indexBy(ports, (p) => p.name);
  const partner: (number | null)[] = [];
  const routes: [number, number][] = [];
  const seen = new Set<string>();
  let unmatched = 0;
  ports.forEach((p, i) => {
    // A string id is the sender's own resolution; an explicit null on a paired port says it couldn't resolve it, so
    // the name isn't looked up behind its back. Absent (FRM): the name.
    const wanted = typeof p.pairedId === "string" ? onlyOne(byId, p.pairedId) : p.pairedId === null || p.paired === null ? null : onlyOne(byName, p.paired);
    const paired = typeof p.pairedId === "string" || p.paired !== null;
    const found = wanted === i ? null : wanted;
    partner.push(found);
    if (found === null) {
      if (paired) unmatched++;
      return;
    }
    const route: [number, number] = i < found ? [i, found] : [found, i];
    const key = `${route[0]}:${route[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(route);
    }
  });
  return { partner, routes, unmatched };
}

/** A port's name as shown: players may leave it empty, so an empty one is named by its kind. */
export const dronePortName = (p: DronePort) => (p.name.trim() === "" ? "Unnamed drone port" : p.name);

/** Who a port is paired with, in words: the partner's name, "Not paired", or the reported name it couldn't match. */
export function pairedWithText(p: DronePort, partner: DronePort | null): string {
  if (partner) return dronePortName(partner);
  if (p.paired === null && typeof p.pairedId !== "string") return "Not paired";
  return `${p.paired ?? "Unknown port"} (not matched to one port)`;
}

/** The cargo a port sends (its input inventory) as item names, or "Nothing". */
export const cargoText = (classes: readonly string[], itemName: (className: string) => string) =>
  classes.length === 0 ? "Nothing" : classes.map(itemName).join(", ");

/** A stable key per port: id and place, with a count only when even that repeats (as markerKeys). */
export function dronePortKeys(ports: readonly DronePort[]): string[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return ports.map((p) => {
    const base = `${p.id}:${p.x}:${p.y}`;
    let n = seen.get(base) ?? 0;
    let key = n === 0 ? base : `${base}:${n}`;
    while (used.has(key)) key = `${base}:${++n}`;
    seen.set(base, n + 1);
    used.add(key);
    return key;
  });
}
