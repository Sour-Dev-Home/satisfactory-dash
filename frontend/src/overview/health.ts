import type { FactoryResponse, PowerResponse, StatusResponse } from "@satisfactory-dash/shared";
import { formatMW } from "../format";

/**
 * The Overview's status-page summary (direction B2). Pure: it only aggregates what the
 * backend already classified (circuit status, tick health, stale) and never re-derives it.
 * The one rule of its own is the factory threshold below, chosen by the owner.
 */
export type Health = "ok" | "paused" | "degraded" | "unavailable" | "outage";

export interface SectionHealth {
  health: Health;
  summary: string;
  /** A warning's cause in a few words, for the Health card's headline ("Factory backed up"). */
  cause?: string;
}

/** A section still loading, or one that failed with no data to show. */
export type SectionState = SectionHealth | "pending" | "error";

/** Factory reads as degraded when more than this share of machines is backed up. */
export const BACKED_UP_DEGRADED_SHARE = 0.25;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const SLOW_TICK = "Server tick is slow";

export function serverHealth({ data, stale }: StatusResponse): SectionHealth {
  if (!data.isGameRunning) return { health: "degraded", summary: "No save loaded", cause: "No save loaded" };
  // The Overview has no paused banner (the owner's call), so this row is the only place it
  // says "paused": keep saying it when a worse state wins.
  const alsoPaused = data.gamePaused ? " · game paused" : "";
  if (stale) {
    return { health: "degraded", summary: `Showing last known data${alsoPaused}`, cause: "Server data is stale" };
  }
  // The tick isn't this row's (the owner's call): it lives in the Health card, and tickState
  // below feeds it into the overall health instead.
  if (data.gamePaused) return { health: "paused", summary: "Paused: no players connected" };
  return {
    health: "ok",
    summary: `${data.sessionName} · ${data.connectedPlayers} / ${data.playerLimit} players`,
  };
}

/**
 * The server tick as an input to the overall health, with no row of its own (the Health card
 * shows it): the backend's tickHealth "slow" is a warning, anything else counts as ok. A save
 * that isn't loaded has no tick to judge; the Server row already says so.
 */
export function tickState({ data }: StatusResponse): SectionHealth {
  if (data.isGameRunning && data.tickHealth === "slow") {
    return { health: "degraded", summary: "Server tick is slow", cause: SLOW_TICK };
  }
  return { health: "ok", summary: "Server tick is healthy" };
}

export function powerHealth({ data, stale }: PowerResponse): SectionHealth {
  const outages = data.circuits.filter((c) => c.status === "outage").length;
  const atRisk = data.circuits.filter((c) => c.status === "at_risk").length;
  if (data.hasOutage) {
    return {
      health: "outage",
      summary: outages > 0 ? `${plural(outages, "circuit has", "circuits have")} a tripped fuse` : "Outage reported",
    };
  }
  if (atRisk > 0) {
    return { health: "degraded", summary: `${plural(atRisk, "circuit is", "circuits are")} at risk`, cause: "Power at risk" };
  }
  if (stale) return { health: "degraded", summary: "Showing last known power data", cause: "Power data is stale" };
  if (data.circuits.length === 0) return { health: "ok", summary: "No power circuits yet" };
  const production = data.circuits.reduce((sum, c) => sum + c.productionMW, 0);
  const capacity = data.circuits.reduce((sum, c) => sum + c.capacityMW, 0);
  return {
    health: "ok",
    summary: `${plural(data.circuits.length, "circuit", "circuits")} · ${formatMW(production)} of ${formatMW(capacity)} capacity`,
  };
}

export function factoryHealth({ data, stale }: FactoryResponse): SectionHealth {
  const total = data.buildings.length;
  const backedUp = data.backedUpCount;
  if (total > 0 && backedUp / total > BACKED_UP_DEGRADED_SHARE) {
    return {
      health: "degraded",
      summary: `${backedUp} of ${plural(total, "machine", "machines")} backed up`,
      cause: "Factory backed up",
    };
  }
  if (stale) return { health: "degraded", summary: "Showing last known factory data", cause: "Factory data is stale" };
  if (total === 0) return { health: "ok", summary: "No machines yet" };
  return { health: "ok", summary: `${plural(total, "machine", "machines")} · ${backedUp} backed up` };
}

/**
 * The owner's call: the banner can be dismissed for warnings and a paused game only. An
 * outage or missing data always shows.
 */
export function canDismiss(health: Health | "pending"): boolean {
  return health === "degraded" || health === "paused";
}

/**
 * Which sections are warning, and at what level: a dismissed banner comes back when this
 * changes (another section starts warning, or one gets worse). Summaries are left out, so
 * a count moving inside a warning that was already dismissed doesn't bring it back.
 */
export function warningKey(sections: readonly { name: string; state: SectionState }[]): string {
  return sections
    .flatMap(({ name, state }) =>
      typeof state === "object" && state.health !== "ok" ? [`${name}:${state.health}`] : [],
    )
    .sort()
    .join("|");
}

const RANK: Record<Health, number> = { ok: 0, paused: 1, degraded: 2, unavailable: 3, outage: 4 };

const HEADLINE: Record<Health, string> = {
  ok: "All systems operational",
  paused: "Game paused",
  degraded: "Running with warnings",
  unavailable: "Some data is unavailable",
  outage: "Power outage",
};

/**
 * The worst section decides the banner. Loading sections only hold back an "all clear".
 * One rule of the owner's: the tick has no row, so when a slow tick is among the warnings the
 * headline names the causes ("Server tick is slow · Factory backed up") instead of the generic
 * "Running with warnings", or nothing on the page would say why.
 */
export function overallHealth(sections: SectionState[]): { health: Health | "pending"; headline: string } {
  let worst: Health = "ok";
  let pending = false;
  for (const section of sections) {
    if (section === "pending") {
      pending = true;
      continue;
    }
    const health = section === "error" ? "unavailable" : section.health;
    if (RANK[health] > RANK[worst]) worst = health;
  }
  if (pending && worst === "ok") return { health: "pending", headline: "Checking…" };
  if (worst === "degraded") {
    const causes = sections.flatMap((s) => (typeof s === "object" && s.health === "degraded" && s.cause ? [s.cause] : []));
    // Each cause once, the tick first (a Set keeps insertion order).
    if (causes.includes(SLOW_TICK)) return { health: worst, headline: [...new Set([SLOW_TICK, ...causes])].join(" · ") };
  }
  return { health: worst, headline: HEADLINE[worst] };
}
