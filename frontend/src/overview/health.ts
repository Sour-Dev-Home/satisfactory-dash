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
}

/** A section still loading, or one that failed with no data to show. */
export type SectionState = SectionHealth | "pending" | "error";

/** Factory reads as degraded when more than this share of machines is backed up. */
export const BACKED_UP_DEGRADED_SHARE = 0.25;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function serverHealth({ data, stale }: StatusResponse): SectionHealth {
  if (!data.isGameRunning) return { health: "degraded", summary: "No save loaded" };
  if (stale) return { health: "degraded", summary: "Showing last known data" };
  if (data.tickHealth === "slow") return { health: "degraded", summary: "Server tick is slow" };
  if (data.gamePaused) return { health: "paused", summary: "Paused: no players connected" };
  return {
    health: "ok",
    summary: `${data.sessionName} · ${data.connectedPlayers} / ${data.playerLimit} players`,
  };
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
  if (atRisk > 0) return { health: "degraded", summary: `${plural(atRisk, "circuit is", "circuits are")} at risk` };
  if (stale) return { health: "degraded", summary: "Showing last known power data" };
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
    return { health: "degraded", summary: `${backedUp} of ${plural(total, "machine", "machines")} backed up` };
  }
  if (stale) return { health: "degraded", summary: "Showing last known factory data" };
  if (total === 0) return { health: "ok", summary: "No machines yet" };
  return { health: "ok", summary: `${plural(total, "machine", "machines")} · ${backedUp} backed up` };
}

const RANK: Record<Health, number> = { ok: 0, paused: 1, degraded: 2, unavailable: 3, outage: 4 };

const HEADLINE: Record<Health, string> = {
  ok: "All systems operational",
  paused: "Game paused",
  degraded: "Running with warnings",
  unavailable: "Some data is unavailable",
  outage: "Power outage",
};

/** The worst section decides the banner. Loading sections only hold back an "all clear". */
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
  return { health: worst, headline: HEADLINE[worst] };
}
