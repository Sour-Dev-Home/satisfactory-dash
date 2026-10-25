import type { z } from "zod";
import {
  TRAIN_ROUTES_MAX_ITEM_CLASSES,
  TRAIN_ROUTES_MAX_ITEMS,
  TRAIN_ROUTES_MAX_PLATFORMS,
  TRAIN_ROUTES_MAX_STOPS,
} from "@satisfactory-dash/shared";
import type { TrainRoutePlatform, TrainRouteRecord, TrainRouteStation, TrainRouteTrain } from "@satisfactory-dash/shared";
import { RawFrmTrainRouteStationSchema, RawFrmTrainRouteTrainSchema } from "../rawSchemas.js";

type RawStation = z.infer<typeof RawFrmTrainRouteStationSchema>;
type RawTrain = z.infer<typeof RawFrmTrainRouteTrainSchema>;

/** The contract's string bounds (`boundedString` 200 characters; item classes 1..200; mode 40). */
const MAX_STRING = 200;
const MAX_MODE = 40;

export interface MappedTrainRoutes {
  /** Stations then trains, each sorted by id, platforms by id, items by class: the same game state always serializes the
   *  same, so the hash dedup writes nothing between builds. */
  data: TrainRouteRecord[];
  /** Records skipped: not the lenient shape (no id or name), an id or name over the contract's length, or past the layer cap.
   *  The agent's conform-don't-reject rule. A bad platform, stop or item inside a kept record is trimmed, not counted. */
  dropped: number;
}

/** The two raw responses of one cycle, as the unvalidated arrays FRM returned. */
export interface RawTrainRouteResponses {
  stations: readonly unknown[];
  trains: readonly unknown[];
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Distinct item classes across inventories, sorted and capped. Classes the contract cannot hold are skipped. */
function itemClasses(inventories: ReadonlyArray<ReadonlyArray<{ ClassName?: string | undefined }>>): string[] {
  const set = new Set<string>();
  for (const inventory of inventories) {
    for (const entry of inventory) {
      const cls = entry.ClassName;
      if (cls !== undefined && cls.length > 0 && cls.length <= MAX_STRING) set.add(cls);
    }
  }
  return [...set].sort(compareText).slice(0, TRAIN_ROUTES_MAX_ITEM_CLASSES);
}

/** FRM's `LoadingMode` ("Loading" / "Unloading") as the contract's `load` / `unload`; an unknown mode passes through lowercased. */
function platformMode(raw: string | undefined): string {
  const mode = (raw ?? "").trim().toLowerCase();
  if (mode === "loading") return "load";
  if (mode === "unloading") return "unload";
  return mode.slice(0, MAX_MODE);
}

function mapStation(raw: RawStation): TrainRouteStation | undefined {
  if (raw.ID.length > MAX_STRING || raw.Name.length > MAX_STRING) return undefined;
  const platforms: TrainRoutePlatform[] = [];
  for (const platform of raw.CargoInventory) {
    // A platform with no id cannot be told apart from another; it is trimmed from the station, not the station dropped.
    if (platform.ID === undefined || platform.ID.length === 0 || platform.ID.length > MAX_STRING) continue;
    platforms.push({ id: platform.ID, mode: platformMode(platform.LoadingMode), items: itemClasses([platform.Inventory]) });
  }
  platforms.sort(byId);
  return { recordType: "station", id: raw.ID, name: raw.Name, platforms: platforms.slice(0, TRAIN_ROUTES_MAX_PLATFORMS) };
}

function mapTrain(raw: RawTrain): TrainRouteTrain | undefined {
  if (raw.ID.length > MAX_STRING || raw.Name.length > MAX_STRING) return undefined;
  // Names are kept exactly (trailing spaces included): a stop matches a station by its name as the game wrote it.
  const stops: string[] = [];
  for (const stop of raw.TimeTable) {
    if (stop.StationName !== undefined && stop.StationName.length <= MAX_STRING) stops.push(stop.StationName);
  }
  return {
    recordType: "train",
    id: raw.ID,
    name: raw.Name,
    stops: stops.slice(0, TRAIN_ROUTES_MAX_STOPS),
    items: itemClasses(raw.Vehicles.map((vehicle) => vehicle.Inventory)),
  };
}

/**
 * ADR-0055 PR 5: projects getTrainStation + getTrains into the `trainRoutes` layer (packages/shared/src/map.ts): one flat
 * array of station and train records. Lenient throughout; a record that is not even `{ID, Name}` is dropped and counted.
 */
export function mapTrainRoutes(raw: RawTrainRouteResponses): MappedTrainRoutes {
  let dropped = 0;
  const stations: TrainRouteStation[] = [];
  const trains: TrainRouteTrain[] = [];
  for (const item of raw.stations) {
    const parsed = RawFrmTrainRouteStationSchema.safeParse(item);
    const mapped = parsed.success ? mapStation(parsed.data) : undefined;
    if (mapped === undefined) dropped++;
    else stations.push(mapped);
  }
  for (const item of raw.trains) {
    const parsed = RawFrmTrainRouteTrainSchema.safeParse(item);
    const mapped = parsed.success ? mapTrain(parsed.data) : undefined;
    if (mapped === undefined) dropped++;
    else trains.push(mapped);
  }
  stations.sort(byId);
  trains.sort(byId);
  const all: TrainRouteRecord[] = [...stations, ...trains];
  if (all.length > TRAIN_ROUTES_MAX_ITEMS) {
    dropped += all.length - TRAIN_ROUTES_MAX_ITEMS;
    all.length = TRAIN_ROUTES_MAX_ITEMS;
  }
  return { data: all, dropped };
}
